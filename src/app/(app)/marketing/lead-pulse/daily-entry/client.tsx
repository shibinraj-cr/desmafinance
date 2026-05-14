"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { validateL1Row, validateL2Row, type RowError } from "@/lib/lead-pulse-validation";

type Source = { id: string; code: string; label: string; displayOrder: number };

type Row = {
  sourceId: string;
  leadsReceived: number;
  connectedCalls: number;
  disqualified: number;
  transferredToL2: number;
  receivedFromL1: number;
  directLeads: number;
  connected: number;
  quoteSent: number;
  closedWon: number;
  closedLost: number;
  status?: string;
  locked?: boolean;
  submittedAt?: string | null;
  entryDate?: string;
};

type Meta = {
  totalFollowups: number;
  referredToDoc: number;
  referredToAbroad: number;
  notes: string;
  status: string;
  locked: boolean;
  submittedAt: string | null;
};

type Props = {
  role: "l1" | "l2";
  displayName: string;
  date: string;
  today: string;
  earliest: string;
  editable: boolean;
  sources: Source[];
  initialEntries: Row[];
  initialMeta: Meta;
  /** Read-only preview for admins / supervisors viewing the form
   *  shape. No date picker, no save / submit buttons, no auto-save
   *  fetch, no remote refetch on date change. */
  preview?: boolean;
};

const TIPS = [
  "High-quality follow-ups increase conversion by 40%.",
  "Close-of-day reviews catch missed leads before they go cold.",
  "Tag a referral as 'agency' or 'candidate' early — it speeds up reporting.",
  "Quote within 24 hours: response rate jumps the longer you wait.",
  "Disqualified ≠ lost: log them anyway so the funnel reflects reality.",
];

export function DailyEntryForm(props: Props) {
  const { role, sources } = props;
  const router = useRouter();

  const [date, setDate] = useState(props.date);
  const [editable, setEditable] = useState(props.editable);
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    buildRowMap(sources, props.initialEntries),
  );
  const [meta, setMeta] = useState<Meta>(props.initialMeta);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Auto-dismiss the success banner so it doesn't linger forever.
  useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(() => setSuccessMsg(null), 6000);
    return () => clearTimeout(t);
  }, [successMsg]);

  // Refresh on date change. We re-fetch the day's data via the JSON API
  // so the URL reflects the chosen date and bookmarking works. Skipped in
  // preview mode — the form never refetches, and the date never changes
  // because the date picker is hidden.
  useEffect(() => {
    if (props.preview) return;
    if (date === props.date) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/marketing/lead-pulse/daily-entry?date=${date}`, {
        cache: "no-store",
      });
      if (cancelled) return;
      if (!res.ok) {
        setServerError("Could not load that date's entry.");
        return;
      }
      const data = (await res.json()) as {
        editable: boolean;
        entries: Row[];
        meta: Meta;
      };
      setEditable(data.editable);
      setRows(buildRowMap(sources, data.entries));
      setMeta(data.meta);
      setServerError(null);
      router.replace(`/marketing/lead-pulse/daily-entry?date=${date}`, { scroll: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [date, props.date, router, sources]);

  const rowErrors = useMemo<Record<string, RowError>>(() => {
    const out: Record<string, RowError> = {};
    for (const s of sources) {
      const r = rows[s.id];
      if (!r) {
        out[s.id] = null;
        continue;
      }
      out[s.id] = role === "l1" ? validateL1Row(r) : validateL2Row(r);
    }
    return out;
  }, [rows, role, sources]);

  const firstError = useMemo(() => {
    for (const s of sources) {
      if (rowErrors[s.id]) return { source: s, err: rowErrors[s.id]! };
    }
    return null;
  }, [rowErrors, sources]);

  const hasAnyValue = useMemo(() => {
    for (const s of sources) {
      const r = rows[s.id];
      if (!r) continue;
      const sum =
        r.leadsReceived +
        r.connectedCalls +
        r.disqualified +
        r.transferredToL2 +
        r.receivedFromL1 +
        r.directLeads +
        r.connected +
        r.quoteSent +
        r.closedWon +
        r.closedLost;
      if (sum > 0) return true;
    }
    return (
      (meta.totalFollowups ?? 0) > 0 ||
      (meta.referredToDoc ?? 0) > 0 ||
      (meta.referredToAbroad ?? 0) > 0 ||
      (meta.notes ?? "").trim().length > 0
    );
  }, [rows, meta, sources]);

  const save = useCallback(
    async (action: "draft" | "submit") => {
      const payloadRows = sources.map((s) => {
        const r = rows[s.id] ?? blankRow(s.id);
        return { ...r, sourceId: s.id };
      });
      const res = await fetch("/api/marketing/lead-pulse/daily-entry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date,
          action,
          rows: payloadRows,
          meta: {
            totalFollowups: meta.totalFollowups,
            referredToDoc: meta.referredToDoc,
            referredToAbroad: meta.referredToAbroad,
            notes: meta.notes,
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const code = (data as { error?: string }).error ?? "save_failed";
        setServerError(humanError(code));
        return false;
      }
      setServerError(null);
      setLastSavedAt(Date.now());
      return true;
    },
    [date, meta, rows, sources],
  );

  // 2-second auto-save debounce while editable + no row errors + at
  // least one value typed.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (props.preview) return;
    if (!editable || firstError || !hasAnyValue) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSavingDraft(true);
      await save("draft");
      setSavingDraft(false);
    }, 2000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [rows, meta, editable, firstError, hasAnyValue, save]);

  async function onSubmit() {
    if (firstError) {
      setServerError(`Validation error: ${rowErrorMsg(firstError.err, firstError.source.label)}`);
      setSuccessMsg(null);
      return;
    }
    setSubmitting(true);
    setSuccessMsg(null);
    const ok = await save("submit");
    setSubmitting(false);
    if (ok) {
      setSuccessMsg(`Entry submitted successfully for ${date}.`);
      router.refresh();
    }
  }

  async function onSaveDraft() {
    setSavingDraft(true);
    await save("draft");
    setSavingDraft(false);
  }

  const tip = useMemo(() => TIPS[Math.floor(Math.random() * TIPS.length)], []);

  return (
    <div className="px-[24px] py-[24px] space-y-[16px]">
      <header className="flex flex-wrap items-end justify-between gap-[16px]">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight">Daily Entry</h1>
          <p className="mt-[4px] text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            {props.displayName ? `${props.displayName} · ` : ""}
            <span style={{ color: roleColor(role), fontWeight: 600 }}>
              {role === "l1" ? "L1 BDE" : "L2 BDE"}
            </span>
            {props.preview && (
              <span
                className="ml-[8px] text-[10px] px-[8px] py-[2px] rounded-full font-bold uppercase tracking-widest"
                style={{
                  backgroundColor: "rgba(250,204,21,0.15)",
                  color: "var(--lp-primary)",
                  border: "1px solid rgba(250,204,21,0.35)",
                }}
              >
                Preview · admin view
              </span>
            )}
          </p>
        </div>
        {!props.preview && (
          <DatePicker date={date} earliest={props.earliest} today={props.today} onChange={setDate} />
        )}
      </header>

      {!props.preview && <NoticeStrip />}

      <div
        className="rounded-[12px] border"
        style={{
          backgroundColor: "var(--lp-surface-container)",
          borderColor: "var(--lp-outline-variant)",
        }}
      >
        <div className="flex items-center justify-between px-[24px] pt-[20px] pb-[12px]">
          <h2 className="text-[16px] font-semibold">Lead Activity by Source</h2>
          <button
            type="button"
            onClick={() => {
              if (!editable) return;
              setRows(buildRowMap(sources, []));
            }}
            className="text-[12px] underline"
            style={{ color: "var(--lp-on-surface-variant)" }}
            disabled={!editable}
          >
            Reset all rows
          </button>
        </div>
        <div className="overflow-x-auto">
          {role === "l1" ? (
            <L1Table sources={sources} rows={rows} setRows={setRows} editable={editable} errors={rowErrors} />
          ) : (
            <L2Table sources={sources} rows={rows} setRows={setRows} editable={editable} errors={rowErrors} />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px]">
        {role === "l1" ? (
          <Card title="Other Activity">
            <NumberField
              label="Total Followups"
              value={meta.totalFollowups}
              onChange={(v) => setMeta((m) => ({ ...m, totalFollowups: v }))}
              disabled={!editable}
            />
            <NumberField
              label="Referred to Study Abroad"
              value={meta.referredToAbroad}
              onChange={(v) => setMeta((m) => ({ ...m, referredToAbroad: v }))}
              disabled={!editable}
            />
          </Card>
        ) : (
          <Card title="Today's Outcomes">
            <NumberField
              label="Documents referred to Doc team"
              value={meta.referredToDoc}
              onChange={(v) => setMeta((m) => ({ ...m, referredToDoc: v }))}
              disabled={!editable}
            />
            <NumberField
              label="Referred to Study Abroad"
              value={meta.referredToAbroad}
              onChange={(v) => setMeta((m) => ({ ...m, referredToAbroad: v }))}
              disabled={!editable}
            />
          </Card>
        )}

        <Card title="Notes">
          <textarea
            rows={3}
            value={meta.notes}
            onChange={(e) => setMeta((m) => ({ ...m, notes: e.target.value }))}
            disabled={!editable}
            placeholder="Add any specific observations or bottlenecks encountered today..."
            className="w-full rounded-[8px] px-[12px] py-[8px] text-[13px]"
          />
        </Card>
      </div>

      {!props.preview && successMsg && (
        <div
          className="rounded-[12px] border-2 flex items-center gap-[10px] px-[16px] py-[12px]"
          style={{
            backgroundColor: "rgba(51, 228, 255, 0.12)",
            borderColor: "var(--lp-cyan)",
            color: "var(--lp-on-surface)",
          }}
          role="status"
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 22, color: "var(--lp-cyan)" }}
          >
            check_circle
          </span>
          <span className="text-[13px] font-semibold">{successMsg}</span>
          <button
            onClick={() => setSuccessMsg(null)}
            className="ml-auto text-[11px] underline"
            style={{ color: "var(--lp-on-surface-variant)" }}
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      )}

      {!props.preview && (
      <div
        className="rounded-[12px] border flex flex-wrap items-center gap-[12px] px-[20px] py-[14px]"
        style={{
          backgroundColor: "var(--lp-surface-container)",
          borderColor: "var(--lp-outline-variant)",
        }}
      >
        <div className="flex-1 min-w-[200px]">
          {serverError ? (
            <p className="text-[13px]" style={{ color: "var(--lp-error)" }}>
              <span className="material-symbols-outlined align-middle" style={{ fontSize: 16 }}>
                error
              </span>{" "}
              {serverError}
            </p>
          ) : firstError ? (
            <p className="text-[13px]" style={{ color: "var(--lp-orange)" }}>
              <span className="material-symbols-outlined align-middle" style={{ fontSize: 16 }}>
                warning
              </span>{" "}
              {rowErrorMsg(firstError.err, firstError.source.label)} · Fix this before submitting.
            </p>
          ) : lastSavedAt ? (
            <p className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
              Last saved {relativeTime(lastSavedAt)}
            </p>
          ) : !editable ? (
            <p className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
              Locked — ask a supervisor for an override to edit.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onSaveDraft}
          disabled={!editable || savingDraft || !!firstError}
          className="h-[40px] px-[16px] rounded-[8px] text-[13px] font-semibold border"
          style={{
            backgroundColor: "transparent",
            borderColor: "var(--lp-outline-variant)",
            color: "var(--lp-on-surface)",
            opacity: !editable || savingDraft || !!firstError ? 0.5 : 1,
          }}
        >
          {savingDraft ? "Saving..." : "Save draft"}
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!editable || submitting || !!firstError || !hasAnyValue}
          className="h-[40px] px-[16px] rounded-[8px] text-[13px] font-semibold"
          style={{
            backgroundColor: "var(--lp-primary)",
            color: "var(--lp-on-primary)",
            opacity: !editable || submitting || !!firstError || !hasAnyValue ? 0.5 : 1,
          }}
        >
          {submitting ? "Submitting..." : meta.status === "submitted" ? "Re-submit entry" : "Submit entry"}
        </button>
      </div>
      )}

      {!props.preview && (
      <div
        className="rounded-[12px] px-[20px] py-[14px] text-[13px]"
        style={{
          backgroundColor: "var(--lp-surface-container)",
          color: "var(--lp-on-surface-variant)",
          borderLeft: "3px solid var(--lp-primary)",
        }}
      >
        <span style={{ color: "var(--lp-primary)", fontWeight: 600 }}>Performance Tip — </span>
        {tip}
      </div>
      )}
    </div>
  );
}

function buildRowMap(sources: Source[], existing: Row[]): Record<string, Row> {
  const out: Record<string, Row> = {};
  for (const s of sources) out[s.id] = blankRow(s.id);
  for (const e of existing) out[e.sourceId] = { ...blankRow(e.sourceId), ...e };
  return out;
}

function blankRow(sourceId: string): Row {
  return {
    sourceId,
    leadsReceived: 0,
    connectedCalls: 0,
    disqualified: 0,
    transferredToL2: 0,
    receivedFromL1: 0,
    directLeads: 0,
    connected: 0,
    quoteSent: 0,
    closedWon: 0,
    closedLost: 0,
  };
}

function NoticeStrip() {
  return (
    <div
      className="rounded-[12px] px-[16px] py-[12px] flex items-center gap-[10px] text-[13px]"
      style={{
        backgroundColor: "rgba(250, 204, 21, 0.10)",
        color: "var(--lp-on-surface)",
        border: "1px solid rgba(250, 204, 21, 0.35)",
      }}
    >
      <span className="material-symbols-outlined" style={{ color: "var(--lp-primary)", fontSize: 18 }}>
        info
      </span>
      You can edit entries up to 3 days back. Older dates show your past activity in read-only mode — pick any date to view history.
    </div>
  );
}

function DatePicker({
  date,
  earliest,
  today,
  onChange,
}: {
  date: string;
  earliest: string;
  today: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-[8px] text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
      Entry date
      <input
        type="date"
        value={date}
        min={earliest}
        max={today}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-[8px] px-[10px] h-[36px] text-[13px]"
      />
    </label>
  );
}

function L1Table({
  sources,
  rows,
  setRows,
  editable,
  errors,
}: {
  sources: Source[];
  rows: Record<string, Row>;
  setRows: (next: Record<string, Row> | ((prev: Record<string, Row>) => Record<string, Row>)) => void;
  editable: boolean;
  errors: Record<string, RowError>;
}) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
          <Th>Source</Th>
          <Th align="right">Leads Received</Th>
          <Th align="right">Connected Calls</Th>
          <Th align="right">Disqualified</Th>
          <Th align="right">Transferred to L2</Th>
        </tr>
      </thead>
      <tbody>
        {sources.map((s) => {
          const r = rows[s.id] ?? blankRow(s.id);
          const err = errors[s.id];
          return (
            <Tr key={s.id} err={err}>
              <Td>
                <div className="flex items-center gap-[6px]">
                  {err && (
                    <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--lp-orange)" }}>
                      warning
                    </span>
                  )}
                  {s.label}
                </div>
              </Td>
              <NumCell value={r.leadsReceived} onChange={(v) => updateRow(setRows, s.id, "leadsReceived", v)} disabled={!editable} />
              <NumCell value={r.connectedCalls} onChange={(v) => updateRow(setRows, s.id, "connectedCalls", v)} disabled={!editable} />
              <NumCell value={r.disqualified} onChange={(v) => updateRow(setRows, s.id, "disqualified", v)} disabled={!editable} />
              <NumCell value={r.transferredToL2} onChange={(v) => updateRow(setRows, s.id, "transferredToL2", v)} disabled={!editable} />
            </Tr>
          );
        })}
      </tbody>
    </table>
  );
}

function L2Table({
  sources,
  rows,
  setRows,
  editable,
  errors,
}: {
  sources: Source[];
  rows: Record<string, Row>;
  setRows: (next: Record<string, Row> | ((prev: Record<string, Row>) => Record<string, Row>)) => void;
  editable: boolean;
  errors: Record<string, RowError>;
}) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
          <Th>Source</Th>
          <Th align="right">From L1</Th>
          <Th align="right">Direct</Th>
          <Th align="right" goldText>Closed-Won</Th>
        </tr>
      </thead>
      <tbody>
        {sources.map((s) => {
          const r = rows[s.id] ?? blankRow(s.id);
          const err = errors[s.id];
          return (
            <Tr key={s.id} err={err}>
              <Td>
                <div className="flex items-center gap-[6px]">
                  {err && (
                    <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--lp-orange)" }}>
                      warning
                    </span>
                  )}
                  {s.label}
                </div>
              </Td>
              <NumCell value={r.receivedFromL1} onChange={(v) => updateRow(setRows, s.id, "receivedFromL1", v)} disabled={!editable} />
              <NumCell value={r.directLeads} onChange={(v) => updateRow(setRows, s.id, "directLeads", v)} disabled={!editable} />
              <NumCell
                value={r.closedWon}
                onChange={(v) => updateRow(setRows, s.id, "closedWon", v)}
                disabled={!editable}
                goldText
              />
            </Tr>
          );
        })}
      </tbody>
    </table>
  );
}

function updateRow(
  setRows: (next: Record<string, Row> | ((prev: Record<string, Row>) => Record<string, Row>)) => void,
  sourceId: string,
  field: keyof Row,
  value: number,
) {
  setRows((prev) => ({
    ...prev,
    [sourceId]: { ...(prev[sourceId] ?? blankRow(sourceId)), [field]: value },
  }));
}

function Th({ children, align, goldText }: { children: React.ReactNode; align?: "left" | "right"; goldText?: boolean }) {
  return (
    <th
      className="px-[16px] py-[10px] text-[11px] font-semibold uppercase tracking-[0.05em]"
      style={{
        textAlign: align ?? "left",
        color: goldText ? "var(--lp-primary)" : "var(--lp-on-surface-variant)",
      }}
    >
      {children}
    </th>
  );
}

function Tr({ children, err }: { children: React.ReactNode; err: RowError }) {
  return (
    <tr
      className="border-t"
      style={{
        borderColor: "var(--lp-outline-variant)",
        backgroundColor: err ? "rgba(255, 182, 147, 0.18)" : undefined,
      }}
    >
      {children}
    </tr>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-[16px] py-[10px] text-[13px]" style={{ color: "var(--lp-on-surface)" }}>
      {children}
    </td>
  );
}

function NumCell({
  value,
  onChange,
  disabled,
  goldText,
  muted,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  goldText?: boolean;
  muted?: boolean;
}) {
  return (
    <td className="px-[12px] py-[6px]">
      <input
        type="number"
        min={0}
        step={1}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return onChange(0);
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          onChange(Math.max(0, Math.floor(n)));
        }}
        disabled={disabled}
        className="w-full h-[36px] rounded-[8px] px-[10px] text-right"
        style={{
          color: goldText ? "var(--lp-primary)" : muted ? "var(--lp-on-surface-variant)" : "var(--lp-on-surface)",
          fontWeight: goldText ? 600 : 500,
        }}
      />
    </td>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-[12px] border p-[20px] space-y-[12px]"
      style={{
        backgroundColor: "var(--lp-surface-container)",
        borderColor: "var(--lp-outline-variant)",
      }}
    >
      <h3 className="text-[14px] font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-[12px] text-[13px]">
      <span style={{ color: "var(--lp-on-surface-variant)" }}>{label}</span>
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return onChange(0);
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          onChange(Math.max(0, Math.floor(n)));
        }}
        disabled={disabled}
        className="w-[90px] h-[34px] rounded-[8px] px-[10px] text-right"
      />
    </label>
  );
}

function rowErrorMsg(err: RowError, label: string): string {
  if (err === "outcomes_exceed_received") return `Outcomes exceed received leads in '${label}'`;
  if (err === "negative") return `Negative numbers not allowed in '${label}'`;
  if (err === "non_integer") return `Whole numbers only in '${label}'`;
  return "";
}

function humanError(code: string): string {
  switch (code) {
    case "row_invalid":
      return "One of the rows has invalid totals. Fix the highlighted row and try again.";
    case "locked":
      return "This entry is locked. Ask a supervisor to override before editing.";
    case "outside_backdate_window":
      return "This date is outside the 3-day editing window.";
    case "forbidden_no_bde_role":
      return "You don't have a BDE role assigned.";
    case "forbidden_inactive":
      return "Your roster row is inactive.";
    default:
      return "Could not save. Try again.";
  }
}

function relativeTime(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

function roleColor(role: "l1" | "l2") {
  return role === "l1" ? "var(--lp-primary)" : "var(--lp-cyan)";
}

/**
 * Admin / supervisor preview of the Daily Entry form. Renders both the
 * L1 and L2 variants in tabbed view so admins can see exactly what each
 * BDE role gets when they sign in. Read-only — no save/submit, no
 * auto-save, no remote refetch; just the shape and labels.
 */
export function AdminDailyEntryPreview({
  sources,
  today,
}: {
  sources: Source[];
  today: string;
}) {
  const [role, setRoleState] = useState<"l1" | "l2">("l1");
  const blankEntries: Row[] = [];
  const blankMeta: Meta = {
    totalFollowups: 0,
    referredToDoc: 0,
    referredToAbroad: 0,
    notes: "",
    status: "draft",
    locked: false,
    submittedAt: null,
  };
  return (
    <div className="px-[24px] pt-[24px] pb-0">
      <div
        className="rounded-[12px] p-[16px] border mb-[16px]"
        style={{
          backgroundColor: "var(--lp-surface-container)",
          borderColor: "var(--lp-outline-variant)",
        }}
      >
        <div className="flex flex-wrap items-center gap-[12px]">
          <p
            className="text-[13px] flex-1"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            <span className="material-symbols-outlined align-middle" style={{ fontSize: 16, color: "var(--lp-primary)" }}>
              visibility
            </span>{" "}
            Admin preview of the BDE Daily Entry form. Toggle between L1 and
            L2 to see each variant. No fields are editable in this view.
          </p>
          <div className="inline-flex items-center gap-[4px] rounded-[8px] p-[4px]" style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
            {(["l1", "l2"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRoleState(r)}
                className="h-[28px] px-[14px] rounded-[6px] text-[12px] font-semibold transition"
                style={{
                  backgroundColor:
                    role === r ? "var(--lp-primary)" : "transparent",
                  color:
                    role === r
                      ? "var(--lp-on-primary)"
                      : "var(--lp-on-surface-variant)",
                }}
              >
                {r === "l1" ? "L1 BDE" : "L2 BDE"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <DailyEntryForm
        role={role}
        displayName="Sample BDE"
        date={today}
        today={today}
        earliest={today}
        editable={false}
        sources={sources}
        initialEntries={blankEntries}
        initialMeta={blankMeta}
        preview
      />
    </div>
  );
}
