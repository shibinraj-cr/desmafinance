"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type RegReason = { code: string; label: string };
type HalfSession = "AM" | "PM";
type LeaveDuration = "full" | HalfSession;

type ExceptionRow = {
  date: string;
  weekday: string;
  status: string;
  in: string | null;
  out: string | null;
  lateMinutes: number | null;
  kind: "absent" | "incomplete" | "halfday" | "late";
  /// A day with a punch was worked — only a half of it can be claimed as leave.
  punched: boolean;
  /// Which half to preselect, read from the punch deviations.
  suggestedHalf: HalfSession;
};
type RegRow = {
  id: string;
  date: string;
  requestType: string;
  reasonType: string;
  reasonLabel: string;
  reason: string;
  halfSession: string | null;
  proposedIn: string | null;
  proposedOut: string | null;
  status: string;
  reviewNote: string | null;
  createdAt: string;
};

const KIND_BADGE: Record<ExceptionRow["kind"], { label: string; cls: string }> = {
  absent: { label: "Absent", cls: "bg-red-50 text-red-700" },
  incomplete: { label: "Missing punch", cls: "bg-yellow-50 text-yellow-700" },
  halfday: { label: "Half-day", cls: "bg-orange-50 text-orange-700" },
  late: { label: "Late arrival (½ day)", cls: "bg-orange-50 text-orange-700" },
};

export function RegularizationRequestClient({
  reasons,
  monthKey,
  prevMonth,
  nextMonth,
  cycleLabel,
  exceptions,
  requests,
}: {
  reasons: RegReason[];
  monthKey: string;
  prevMonth: string;
  nextMonth: string;
  cycleLabel: string;
  exceptions: ExceptionRow[];
  requests: RegRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  // Which exception row is open, and for which request type.
  const [open, setOpen] = useState<{ date: string; type: "punch" | "leave" | "note" } | null>(null);
  const [rowForm, setRowForm] = useState({
    in: "",
    out: "",
    reason: "",
    duration: "full" as LeaveDuration,
  });
  const [showManual, setShowManual] = useState(false);
  const [manual, setManual] = useState({
    date: new Date().toISOString().slice(0, 10),
    requestType: "punch" as "punch" | "leave",
    reasonType: reasons[0]?.code ?? "missing_punch",
    duration: "full" as LeaveDuration,
    reason: "",
    proposedIn: "",
    proposedOut: "",
  });

  function gotoMonth(m: string) {
    router.push(`/me/regularization?month=${m}`);
  }

  function openRow(date: string, type: "punch" | "leave" | "note", x?: ExceptionRow) {
    setOpen({ date, type });
    setRowForm({
      in: "",
      out: "",
      reason: "",
      // A punched day was worked, so it can only be claimed half at a time —
      // start on the half the punches point at. An unpunched day defaults to
      // the full day, which is what an absence usually is.
      duration: x?.punched ? x.suggestedHalf : "full",
    });
    setErr(null);
    setOk(null);
  }

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const res = await fetch("/api/me/regularization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setOk("Request submitted — it's been sent to HR for approval.");
      setOpen(null);
      setManual((m) => ({ ...m, reason: "", proposedIn: "", proposedOut: "" }));
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function submitRow() {
    if (!open) return;
    if (open.type === "punch") {
      post({
        date: open.date,
        requestType: "punch",
        reasonType: "missing_punch",
        reason: rowForm.reason,
        proposedIn: rowForm.in || null,
        proposedOut: rowForm.out || null,
      });
    } else if (open.type === "note") {
      post({ date: open.date, requestType: "note", reason: rowForm.reason });
    } else {
      post({
        date: open.date,
        requestType: "leave",
        reason: rowForm.reason,
        halfSession: rowForm.duration === "full" ? null : rowForm.duration,
      });
    }
  }

  return (
    <>
      <Section title="Attendance to review">
        <div className="flex flex-wrap items-center gap-sm mb-base">
          <button onClick={() => gotoMonth(prevMonth)} className="px-sm py-sm rounded border border-outline-variant">←</button>
          <label className="flex items-center gap-xs text-label-sm">
            <span className="text-on-surface-variant">Cycle</span>
            <input
              type="month"
              value={monthKey}
              onChange={(e) => gotoMonth(e.target.value)}
              className="px-sm py-sm rounded border border-outline-variant bg-surface"
            />
          </label>
          <button onClick={() => gotoMonth(nextMonth)} className="px-sm py-sm rounded border border-outline-variant">→</button>
          <span className="text-label-sm text-on-surface-variant">{cycleLabel}</span>
        </div>

        {err && <p className="text-error text-label-sm mb-sm">{err}</p>}
        {ok && <p className="text-green-700 text-label-sm mb-sm">{ok}</p>}

        {exceptions.length === 0 ? (
          <p className="py-lg text-center text-on-surface-variant">
            Nothing to review for this cycle — your attendance is complete. 🎉
          </p>
        ) : (
          <div className="space-y-sm">
            {exceptions.map((x) => {
              const isOpen = open?.date === x.date;
              const badge = KIND_BADGE[x.kind];
              // A punched day was worked, so a FULL-day leave can't apply to it
              // — but half of it can, which is what a half-day leave request is
              // for. Those days also keep the "Explain" option, for when the
              // employee wants the reason on record without claiming leave.
              const isPunched = x.punched;
              return (
                <div key={x.date} className="rounded-lg border border-outline-variant p-sm">
                  <div className="flex flex-wrap items-center gap-sm">
                    <div className="min-w-[120px]">
                      <span className="font-semibold">{x.date}</span>
                      <span className="ml-xs text-caption text-on-surface-variant">{x.weekday}</span>
                    </div>
                    <span className={"text-caption px-xs py-[2px] rounded font-bold " + badge.cls}>
                      {badge.label}
                    </span>
                    <span className="text-caption text-on-surface-variant">
                      Punch: {x.in ?? "—"} → {x.out ?? "—"}
                    </span>
                    {isPunched && x.lateMinutes != null && x.lateMinutes > 0 && (
                      <span className="text-caption text-orange-700">Late by {x.lateMinutes} min</span>
                    )}
                    <div className="ml-auto flex gap-xs">
                      <button
                        onClick={() => openRow(x.date, "punch", x)}
                        className={
                          "px-sm py-xs rounded text-label-sm font-semibold " +
                          (isOpen && open?.type === "punch"
                            ? "bg-primary text-on-primary"
                            : "bg-surface-container text-on-surface")
                        }
                      >
                        Punch fix
                      </button>
                      <button
                        onClick={() => openRow(x.date, "leave", x)}
                        className={
                          "px-sm py-xs rounded text-label-sm font-semibold " +
                          (isOpen && open?.type === "leave"
                            ? "bg-primary text-on-primary"
                            : "bg-surface-container text-on-surface")
                        }
                      >
                        {isPunched ? "Request half-day" : "Request leave"}
                      </button>
                      {isPunched && (
                        <button
                          onClick={() => openRow(x.date, "note", x)}
                          className={
                            "px-sm py-xs rounded text-label-sm font-semibold " +
                            (isOpen && open?.type === "note"
                              ? "bg-primary text-on-primary"
                              : "bg-surface-container text-on-surface")
                          }
                        >
                          Explain
                        </button>
                      )}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-sm border-t border-outline-variant pt-sm space-y-sm">
                      {open?.type === "punch" && (
                        <div className="grid grid-cols-2 gap-sm">
                          <Field label="Correct In time">
                            <input
                              type="time"
                              value={rowForm.in}
                              onChange={(e) => setRowForm({ ...rowForm, in: e.target.value })}
                              className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
                            />
                          </Field>
                          <Field label="Correct Out time">
                            <input
                              type="time"
                              value={rowForm.out}
                              onChange={(e) => setRowForm({ ...rowForm, out: e.target.value })}
                              className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
                            />
                          </Field>
                        </div>
                      )}
                      {open?.type === "leave" && (
                        <Field label="Duration">
                          <DurationPicker
                            value={rowForm.duration}
                            onChange={(duration) => setRowForm({ ...rowForm, duration })}
                            allowFullDay={!isPunched}
                            note={
                              isPunched
                                ? `${x.in ?? "—"}–${x.out ?? "—"} is on record for this day, so you worked part of it — only a half-day can be claimed as leave.`
                                : null
                            }
                          />
                        </Field>
                      )}
                      <Field
                        label={
                          open?.type === "leave"
                            ? "Reason for leave"
                            : open?.type === "note"
                              ? "Explanation"
                              : "What happened?"
                        }
                      >
                        <textarea
                          value={rowForm.reason}
                          onChange={(e) => setRowForm({ ...rowForm, reason: e.target.value })}
                          rows={2}
                          placeholder={
                            open?.type === "leave"
                              ? "e.g. approved casual leave / sick leave (5+ characters)…"
                              : open?.type === "note"
                                ? "e.g. half-day leave in the morning, came late after (5+ characters)…"
                                : "e.g. forgot to punch out (5+ characters)…"
                          }
                          className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
                        />
                      </Field>
                      <div className="flex justify-end gap-sm">
                        <button onClick={() => setOpen(null)} className="px-sm py-xs text-label-sm underline text-on-surface-variant">
                          Cancel
                        </button>
                        <button
                          onClick={submitRow}
                          disabled={busy || rowForm.reason.trim().length < 5}
                          className="px-md py-xs rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-50"
                        >
                          {busy
                            ? "Submitting…"
                            : open?.type === "leave"
                              ? rowForm.duration === "full"
                                ? "Request full-day leave"
                                : `Request ${rowForm.duration === "AM" ? "first" : "second"}-half leave`
                              : open?.type === "note"
                                ? "Submit explanation"
                                : "Submit punch fix"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        title="Request for another date"
        action={
          <button onClick={() => setShowManual((s) => !s)} className="text-label-sm underline text-on-surface-variant">
            {showManual ? "Hide" : "Show"}
          </button>
        }
      >
        {showManual && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-base">
              <Field label="Date">
                <input
                  type="date"
                  value={manual.date}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setManual({ ...manual, date: e.target.value })}
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
                />
              </Field>
              <Field label="Request">
                <select
                  value={manual.requestType}
                  onChange={(e) =>
                    setManual({ ...manual, requestType: e.target.value as "punch" | "leave" })
                  }
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
                >
                  <option value="punch">Punch correction</option>
                  <option value="leave">Leave</option>
                </select>
              </Field>
              {manual.requestType === "leave" ? (
                <div className="sm:col-span-2">
                  <Field label="Duration">
                    <DurationPicker
                      value={manual.duration}
                      onChange={(duration) => setManual({ ...manual, duration })}
                      allowFullDay
                      note={
                        manual.duration === "full"
                          ? "A full day can only be claimed on a day with no punch — if you worked part of it, pick a half instead."
                          : null
                      }
                    />
                  </Field>
                </div>
              ) : (
                <>
                  <Field label="Issue">
                    <select
                      value={manual.reasonType}
                      onChange={(e) => setManual({ ...manual, reasonType: e.target.value })}
                      className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
                    >
                      {reasons.map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Correct In time">
                    <input
                      type="time"
                      value={manual.proposedIn}
                      onChange={(e) => setManual({ ...manual, proposedIn: e.target.value })}
                      className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
                    />
                  </Field>
                  <Field label="Correct Out time">
                    <input
                      type="time"
                      value={manual.proposedOut}
                      onChange={(e) => setManual({ ...manual, proposedOut: e.target.value })}
                      className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
                    />
                  </Field>
                </>
              )}
              <div className="sm:col-span-2">
                <Field label={manual.requestType === "leave" ? "Reason for leave" : "Explanation"}>
                  <textarea
                    value={manual.reason}
                    onChange={(e) => setManual({ ...manual, reason: e.target.value })}
                    rows={2}
                    className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
                    placeholder={
                      manual.requestType === "leave"
                        ? "e.g. sick leave for the afternoon (5+ characters)…"
                        : "Briefly describe what happened (5+ characters)…"
                    }
                  />
                </Field>
              </div>
            </div>
            <div className="mt-base flex justify-end">
              <button
                onClick={() =>
                  post(
                    manual.requestType === "leave"
                      ? {
                          date: manual.date,
                          requestType: "leave",
                          reason: manual.reason,
                          halfSession: manual.duration === "full" ? null : manual.duration,
                        }
                      : {
                          date: manual.date,
                          requestType: "punch",
                          reasonType: manual.reasonType,
                          reason: manual.reason,
                          proposedIn: manual.proposedIn || null,
                          proposedOut: manual.proposedOut || null,
                        },
                  )
                }
                disabled={busy || manual.reason.trim().length < 5}
                className="px-md py-sm rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-50"
              >
                {busy ? "Submitting…" : "Submit request"}
              </button>
            </div>
          </>
        )}
      </Section>

      <Section title="My requests">
        {requests.length === 0 ? (
          <p className="py-lg text-center text-on-surface-variant">No requests yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-label-sm">
              <thead className="bg-surface-container text-on-surface-variant uppercase tracking-wider text-caption">
                <tr>
                  <th className="px-sm py-xs text-left">Submitted</th>
                  <th className="px-sm py-xs text-left">Date</th>
                  <th className="px-sm py-xs text-left">Type</th>
                  <th className="px-sm py-xs text-left">Reason</th>
                  <th className="px-sm py-xs text-left">In</th>
                  <th className="px-sm py-xs text-left">Out</th>
                  <th className="px-sm py-xs text-left">Status</th>
                  <th className="px-sm py-xs text-left">HR note</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-t border-outline-variant">
                    <td className="px-sm py-xs text-on-surface-variant">
                      {new Date(r.createdAt).toLocaleString("en-IN", { hour12: false })}
                    </td>
                    <td className="px-sm py-xs">{r.date}</td>
                    <td className="px-sm py-xs">
                      <span
                        className={
                          "px-xs py-[1px] rounded text-caption font-semibold " +
                          (r.requestType === "leave"
                            ? "bg-purple-50 text-purple-700"
                            : r.requestType === "note"
                              ? "bg-indigo-50 text-indigo-700"
                              : "bg-yellow-50 text-yellow-700")
                        }
                      >
                        {r.requestType === "leave"
                          ? r.halfSession
                            ? `½ Leave · ${r.halfSession === "AM" ? "1st" : "2nd"}`
                            : "Leave"
                          : r.requestType === "note"
                            ? "Explain"
                            : "Punch"}
                      </span>
                    </td>
                    <td className="px-sm py-xs">
                      <p className="text-caption text-on-surface-variant max-w-md">{r.reason}</p>
                    </td>
                    <td className="px-sm py-xs font-mono">{r.proposedIn ?? "—"}</td>
                    <td className="px-sm py-xs font-mono">{r.proposedOut ?? "—"}</td>
                    <td className="px-sm py-xs">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-sm py-xs text-on-surface-variant text-caption">{r.reviewNote ?? "—"}</td>
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

/**
 * Full day / first half / second half, as three radios rather than a select —
 * the whole point of the feature is that the two halves are applied for
 * separately, and a collapsed dropdown hides that they're distinct choices.
 *
 * `allowFullDay` is false on a day that already carries a punch: it was worked,
 * so only a half of it can be claimed (the API rejects the full day too).
 */
function DurationPicker({
  value,
  onChange,
  allowFullDay,
  note,
}: {
  value: LeaveDuration;
  onChange: (v: LeaveDuration) => void;
  allowFullDay: boolean;
  note: string | null;
}) {
  const options: { code: LeaveDuration; label: string; hint: string }[] = [
    { code: "full", label: "Full day", hint: "1 day" },
    { code: "AM", label: "First half", hint: "morning · 0.5 day" },
    { code: "PM", label: "Second half", hint: "afternoon · 0.5 day" },
  ];
  return (
    <>
      <div className="flex flex-wrap gap-xs">
        {options
          .filter((o) => allowFullDay || o.code !== "full")
          .map((o) => (
            <button
              key={o.code}
              type="button"
              aria-pressed={value === o.code}
              onClick={() => onChange(o.code)}
              className={
                "px-sm py-xs rounded-lg border text-label-sm text-left " +
                (value === o.code
                  ? "border-primary bg-primary text-on-primary font-semibold"
                  : "border-outline-variant bg-surface-container text-on-surface")
              }
            >
              {o.label}
              <span
                className={
                  "block text-caption " +
                  (value === o.code ? "text-on-primary/80" : "text-on-surface-variant")
                }
              >
                {o.hint}
              </span>
            </button>
          ))}
      </div>
      {note && <p className="text-caption text-on-surface-variant mt-xs">{note}</p>}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-xs block">
      <span className="text-caption uppercase tracking-wider text-on-surface-variant">{label}</span>
      {children}
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "approved"
      ? "bg-green-100 text-green-800"
      : status === "rejected"
        ? "bg-red-100 text-red-800"
        : status === "clarification"
          ? "bg-yellow-100 text-yellow-800"
          : "bg-blue-100 text-blue-800";
  return (
    <span className={`px-xs py-[1px] rounded text-caption font-semibold uppercase ${cls}`}>{status}</span>
  );
}
