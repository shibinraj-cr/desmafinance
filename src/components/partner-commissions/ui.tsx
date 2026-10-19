"use client";

import { useEffect, useRef, useState } from "react";
import { ENROLLMENT_STATE_LABEL, INVOICE_STATUS_LABEL, type EnrollmentState, type InvoiceStatus } from "@/lib/partner-commissions/constants";
import { commissionOf, fmtMoney, intakeMonthOptions } from "@/lib/partner-commissions/logic";

/** Shared building blocks for the Partner Commissions pages (Finance + Partner Enrollments). */

export const inputCls =
  "w-full h-10 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md disabled:bg-surface-container-low disabled:text-on-surface-variant";
export const btnCls =
  "inline-flex items-center gap-1.5 px-md h-10 rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";
export const primaryBtnCls =
  "inline-flex items-center gap-1.5 px-md h-10 rounded-lg bg-primary text-on-primary text-body-md font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";
export const linkBtnCls = "text-accent font-semibold underline underline-offset-2 hover:opacity-80 disabled:opacity-50";
export const cardCls = "bg-surface-container-lowest border border-outline-variant rounded-xl";

export const AUD = (n: number) => `AUD ${fmtMoney(n)}`;
export const AED = (n: number) => `AED ${fmtMoney(n)}`;
export const INR = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MON[m - 1]} ${y}`;
}
export function fmtDow(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${fmtDate(iso)}`;
}

export function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined text-[18px] leading-none align-middle ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

const TONES = {
  ok: "bg-green-100 text-green-800",
  warn: "bg-amber-100 text-amber-800",
  info: "bg-blue-100 text-blue-800",
  bad: "bg-red-100 text-red-800",
  neutral: "bg-surface-container text-on-surface-variant",
  gold: "bg-primary-fixed text-accent ring-1 ring-inset ring-primary-container",
} as const;
export type Tone = keyof typeof TONES;

export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label-sm font-semibold whitespace-nowrap ${TONES[tone]}`}>{children}</span>;
}

const ENR_TONE: Record<EnrollmentState, Tone> = { fullypaid: "gold", paying: "info", notstarted: "neutral", invoiced: "warn", received: "ok", withdrawn: "bad" };
export function EnrollmentPill({ state }: { state: EnrollmentState }) {
  return <Pill tone={ENR_TONE[state]}>{ENROLLMENT_STATE_LABEL[state]}</Pill>;
}
const INV_TONE: Record<InvoiceStatus, Tone> = { draft: "neutral", sent: "info", awaiting: "warn", partpaid: "info", paid: "ok", cancelled: "bad" };
export function InvoicePill({ status }: { status: string }) {
  const s = (status in INV_TONE ? status : "draft") as InvoiceStatus;
  return <Pill tone={INV_TONE[s]}>{INVOICE_STATUS_LABEL[s]}</Pill>;
}

export function ProgramTag({ code }: { code: string }) {
  return <span className="inline-block px-1.5 py-px rounded border border-outline-variant bg-surface-container-low text-[10.5px] font-bold tracking-wider text-on-surface-variant">{code}</span>;
}

export function Callout({ tone = "neutral", icon, children }: { tone?: "neutral" | "gold" | "bad" | "ok"; icon?: string; children: React.ReactNode }) {
  const cls =
    tone === "gold"
      ? "bg-primary-fixed/40 border-primary-container"
      : tone === "bad"
        ? "bg-error-container border-transparent text-on-error-container"
        : tone === "ok"
          ? "bg-green-50 border-green-200 text-green-900"
          : "bg-surface-container-low border-outline-variant";
  return (
    <div className={`flex gap-2.5 items-start px-sm py-2.5 rounded-lg border text-body-md ${cls}`}>
      {icon ? <Icon name={icon} className="mt-0.5" /> : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Field({ label, children, hint, className = "" }: { label: string; children: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 min-w-0 ${className}`}>
      <span className="text-label-sm font-semibold text-on-surface-variant">{label}</span>
      {children}
      {hint ? <span className="text-caption text-on-surface-variant">{hint}</span> : null}
    </label>
  );
}

export function Modal({ title, subtitle, onClose, children, footer, wide }: { title: string; subtitle?: React.ReactNode; onClose: () => void; children: React.ReactNode; footer: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-md bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`w-full ${wide ? "max-w-3xl" : "max-w-xl"} max-h-full overflow-auto bg-surface-container-lowest rounded-xl border border-outline-variant shadow-xl flex flex-col`}>
        <div className="px-lg pt-lg pb-sm">
          <h3 className="text-h3 text-on-surface">{title}</h3>
          {subtitle ? <p className="text-caption text-on-surface-variant mt-0.5">{subtitle}</p> : null}
        </div>
        <div className="px-lg pb-md flex flex-col gap-sm">{children}</div>
        <div className="flex justify-end gap-2 px-lg py-sm border-t border-outline-variant bg-surface-container-low rounded-b-xl">{footer}</div>
      </div>
    </div>
  );
}

export function Drawer({ onClose, children, label }: { onClose: () => void; children: React.ReactNode; label: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside aria-label={label} className="absolute right-0 top-0 bottom-0 w-full max-w-[560px] bg-surface-container-lowest border-l border-outline-variant shadow-xl flex flex-col">
        {children}
      </aside>
    </div>
  );
}

export class ApiError extends Error {}

/** POST JSON and return the parsed body; throws ApiError carrying the server's message. */
export async function api<T = unknown>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { message?: string; error?: string; issues?: Array<{ message: string }> };
  if (!res.ok) {
    throw new ApiError(json.message || json.issues?.[0]?.message || (res.status === 403 ? "You don't have access to do that." : "Something went wrong. Try again."));
  }
  return json as T;
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = (m: string) => {
    setMsg(m);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setMsg(null), 4500);
  };
  const node = msg ? (
    <div role="status" aria-live="polite" className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[60] max-w-[min(560px,calc(100%-32px))] px-md py-2.5 rounded-lg bg-on-surface text-surface text-body-md font-medium shadow-lg">
      {msg}
    </div>
  ) : null;
  return { show, node };
}

// ── enrollment form (shared by Finance and Partner Enrollments) ──────────────

export type ProgramOption = { code: string; partnerName: string; courseName: string; defaultFee: number | null; defaultPct: number | null; layout: string };

type LeadHit = { id: string; name: string; hint: string };

function LeadPicker({ value, onChange }: { value: LeadHit | null; onChange: (l: LeadHit | null) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<LeadHit[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/finance/partner-commissions/leads?q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { leads: [] }))
        .then((j: { leads: LeadHit[] }) => setHits(j.leads))
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
  }, [q]);
  if (value) {
    return (
      <div className="flex items-center gap-2 h-10 px-sm rounded-lg border border-outline-variant bg-surface-container-low text-body-md">
        <Icon name="link" />
        <span className="truncate flex-1">{value.name}</span>
        <button type="button" className={linkBtnCls} onClick={() => onChange(null)}>
          Unlink
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input className={inputCls} value={q} placeholder="Search CRM leads by name (optional)" onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && hits.length > 0 ? (
        <ul className="absolute z-10 left-0 right-0 mt-1 max-h-60 overflow-auto bg-surface-container-lowest border border-outline-variant rounded-lg shadow-lg">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" className="w-full text-left px-sm py-2 hover:bg-surface-container-low" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(h); setQ(""); setOpen(false); }}>
                <span className="font-medium">{h.name}</span>
                {h.hint ? <span className="text-caption text-on-surface-variant"> · {h.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * New-enrollment form. `finance` unlocks the commission %, the course name and
 * the optional 1st installment; everyone else gets the program's defaults and
 * Finance records payments.
 */
export function EnrollmentForm({
  programs,
  today,
  finance,
  onCancel,
  onCreated,
}: {
  programs: ProgramOption[];
  today: string;
  finance: boolean;
  onCancel: () => void;
  onCreated: (id: string, name: string) => void;
}) {
  const first = programs[0];
  const [program, setProgram] = useState(first?.code ?? "");
  const cfg = programs.find((p) => p.code === program) ?? first;
  const [name, setName] = useState("");
  const [lead, setLead] = useState<LeadHit | null>(null);
  const [studentId, setStudentId] = useState("");
  const [courseName, setCourseName] = useState(cfg?.courseName ?? "");
  const months = intakeMonthOptions(today);
  const [intake, setIntake] = useState(months[13] ?? months[0]);
  const [fee, setFee] = useState(cfg?.defaultFee != null ? String(cfg.defaultFee) : "");
  const [pct, setPct] = useState(cfg?.defaultPct != null ? String(cfg.defaultPct) : "");
  const [paidNow, setPaidNow] = useState(false);
  const [paidAmt, setPaidAmt] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [paidRef, setPaidRef] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pick(code: string) {
    setProgram(code);
    const c = programs.find((p) => p.code === code);
    if (!c) return;
    setCourseName(c.courseName);
    setFee(c.defaultFee != null ? String(c.defaultFee) : "");
    setPct(c.defaultPct != null ? String(c.defaultPct) : "");
  }

  const feeN = parseFloat(fee);
  const pctN = finance ? parseFloat(pct) : (cfg?.defaultPct ?? NaN);

  async function submit() {
    setErr(null);
    if (!name.trim() && lead) setName(lead.name);
    const candidateName = name.trim() || lead?.name || "";
    if (!candidateName) return setErr("Enter the candidate's name.");
    if (!(feeN > 0)) return setErr("Enter the total course fee in AUD.");
    if (finance && !(pctN >= 0 && pctN <= 100)) return setErr("Commission % must be between 0 and 100.");
    let firstPayment = null;
    if (finance && paidNow) {
      const a = parseFloat(paidAmt);
      if (!(a > 0)) return setErr("Enter the 1st installment, or untick the box.");
      if (a > feeN) return setErr("The 1st installment can't be more than the course fee.");
      firstPayment = { amount: a, paidOn, reference: paidRef || null };
    }
    setBusy(true);
    try {
      const res = await api<{ id: string }>("/api/finance/partner-commissions/enrollments", {
        program,
        candidateName,
        leadId: lead?.id ?? null,
        studentId: studentId || null,
        courseName: finance ? courseName : null,
        intakeMonth: intake,
        courseFee: feeN,
        commissionPct: finance ? pctN : null,
        firstPayment,
      });
      onCreated(res.id, candidateName);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't add the enrollment.");
    } finally {
      setBusy(false);
    }
  }

  if (programs.length === 0) {
    return (
      <Modal title="New enrollment" onClose={onCancel} footer={<button className={btnCls} onClick={onCancel}>Close</button>}>
        <Callout icon="info">No program is set up yet. A Finance Manager adds partners and programs on the Partner Commissions Settings tab.</Callout>
      </Modal>
    );
  }

  return (
    <Modal
      title="New enrollment"
      subtitle="The total course fee is fixed here. Each installment Finance records later comes off the balance."
      onClose={onCancel}
      footer={
        <>
          <button className={btnCls} onClick={onCancel} disabled={busy}>Cancel</button>
          <button className={primaryBtnCls} onClick={submit} disabled={busy}>{busy ? "Adding…" : "Add enrollment"}</button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-sm">
        <Field label="Program">
          <select className={inputCls} value={program} onChange={(e) => pick(e.target.value)}>
            {programs.map((p) => (
              <option key={p.code} value={p.code}>{p.code}</option>
            ))}
          </select>
        </Field>
        <Field label="Partner">
          <input className={inputCls} value={cfg?.partnerName ?? ""} disabled />
        </Field>
      </div>
      <Field label="Linked CRM lead">
        <LeadPicker value={lead} onChange={(l) => { setLead(l); if (l && !name.trim()) setName(l.name); }} />
      </Field>
      <Field label="Candidate name">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="As the partner knows them" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-sm">
        <Field label="Intake month">
          <select className={inputCls} value={intake} onChange={(e) => setIntake(e.target.value)}>
            {months.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label={cfg?.layout === "detailed" ? "Student ID" : "Student ID (optional)"} hint={cfg?.layout === "detailed" ? "Printed on this partner's invoices. Add it later if you don't have it yet." : undefined}>
          <input className={inputCls} value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="e.g. M2534455" />
        </Field>
      </div>
      {finance ? (
        <Field label="Course name on invoice">
          <input className={inputCls} value={courseName} onChange={(e) => setCourseName(e.target.value)} />
        </Field>
      ) : null}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-sm">
        <Field label="Total course fee (AUD)">
          <input className={inputCls} type="number" min={1} step="1" value={fee} onChange={(e) => setFee(e.target.value)} />
        </Field>
        {finance ? (
          <Field label="Commission %">
            <input className={inputCls} type="number" min={0} max={100} step="0.5" value={pct} onChange={(e) => setPct(e.target.value)} />
          </Field>
        ) : (
          <Field label="Commission">
            <input className={inputCls} value={cfg?.defaultPct != null ? `${cfg.defaultPct}% (set by Finance)` : "Not set yet"} disabled />
          </Field>
        )}
      </div>
      {feeN > 0 && pctN >= 0 ? <p className="text-caption text-on-surface-variant">Commission when fully paid: {AUD(commissionOf(feeN, pctN))}</p> : null}
      {finance ? (
        <>
          <label className="flex items-center gap-2 text-body-md font-medium">
            <input type="checkbox" checked={paidNow} onChange={(e) => { setPaidNow(e.target.checked); if (e.target.checked && !paidAmt && feeN > 0) setPaidAmt(String(Math.round(feeN / 2))); }} />
            The 1st installment is already paid
          </label>
          {paidNow ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-sm">
              <Field label="1st installment (AUD)"><input className={inputCls} type="number" min={1} step="0.01" value={paidAmt} onChange={(e) => setPaidAmt(e.target.value)} /></Field>
              <Field label="Paid on"><input className={inputCls} type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
              <Field label="Reference"><input className={inputCls} value={paidRef} onChange={(e) => setPaidRef(e.target.value)} placeholder="Receipt no. or note" /></Field>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-caption text-on-surface-variant">Finance records the fee installments as the candidate pays.</p>
      )}
      {err ? <p className="text-body-md text-error font-medium">{err}</p> : null}
    </Modal>
  );
}
