"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  HANDOVER_CHANNELS,
  HANDOVER_STATUSES,
  MAX_HANDOVER_ROWS,
  parseHandoverPaste,
  type HandoverChannel,
} from "@/lib/crm-handover";

type Bde = { userId: string; displayName: string };

type SaveResult = {
  saved: { id: string; leadName: string | null; phoneE164: string; status: "pending" | "duplicate" }[];
  errors: { index: number; phone: string; reason: string }[];
};

const inputCls =
  "w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-md text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";
const controlCls =
  "h-9 rounded-lg border border-outline-variant bg-surface-container-lowest px-md text-label-sm font-semibold text-on-surface outline-none focus:border-primary";
const primaryBtn =
  "inline-flex h-10 items-center rounded-lg bg-primary px-lg text-label-sm font-bold text-on-primary hover:opacity-90 disabled:opacity-50";
const tabCls = (on: boolean) =>
  `h-9 rounded-lg px-md text-label-sm font-semibold ${on ? "bg-surface-container-high text-on-surface" : "text-on-surface-variant hover:bg-surface-container-low"}`;

function Field({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor: string }) {
  return (
    <div className="space-y-xs">
      <label htmlFor={htmlFor} className="block text-label-sm font-semibold text-on-surface">
        {label}
      </label>
      {children}
    </div>
  );
}

function ChannelAndBde({
  channel,
  setChannel,
  bde,
  setBde,
  bdes,
  idPrefix,
}: {
  channel: HandoverChannel;
  setChannel: (c: HandoverChannel) => void;
  bde: string;
  setBde: (b: string) => void;
  bdes: Bde[];
  idPrefix: string;
}) {
  return (
    <>
      <Field label="Source" htmlFor={`${idPrefix}-channel`}>
        <select id={`${idPrefix}-channel`} className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value as HandoverChannel)}>
          {HANDOVER_CHANNELS.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Give to (BDE)" htmlFor={`${idPrefix}-bde`}>
        <select id={`${idPrefix}-bde`} className={inputCls} value={bde} onChange={(e) => setBde(e.target.value)}>
          <option value="">Choose…</option>
          {bdes.map((b) => (
            <option key={b.userId} value={b.userId}>
              {b.displayName}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

function ResultLine({ result }: { result: SaveResult }) {
  const pending = result.saved.filter((s) => s.status === "pending").length;
  const dups = result.saved.filter((s) => s.status === "duplicate");
  return (
    <div className="space-y-xs rounded-lg bg-surface-container-low px-md py-sm text-label-sm">
      {pending > 0 && (
        <p className="text-green-800">
          {pending} handover{pending === 1 ? "" : "s"} saved — the BDE has been notified.
        </p>
      )}
      {dups.map((d) => (
        <p key={d.id} className="text-on-surface">
          {d.leadName ?? d.phoneE164}: already a lead — saved as a duplicate and linked to it.
        </p>
      ))}
      {result.errors.map((e) => (
        <p key={e.index} className="text-error">
          {e.phone}: {e.reason}
        </p>
      ))}
    </div>
  );
}

async function save(channel: HandoverChannel, assignedBdeId: string, rows: { leadName?: string | null; phone: string; note?: string | null }[]) {
  const res = await fetch("/api/crm/handovers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channel, assignedBdeId, rows }),
  });
  const d = (await res.json().catch(() => ({}))) as SaveResult & { message?: string; error?: string };
  if (!res.ok) throw new Error(d.message || (d.error === "validation_error" ? "Check the fields." : "Could not save."));
  return d;
}

/** The Marketing Admin's New handover form and bulk paste grid. */
export function HandoverForms({ bdes }: { bdes: Bde[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"single" | "bulk">("single");
  const [channel, setChannel] = useState<HandoverChannel>("youtube");
  const [bde, setBde] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SaveResult | null>(null);
  const parsed = useMemo(() => parseHandoverPaste(paste), [paste]);

  async function submit() {
    setError(null);
    setResult(null);
    if (!bde) return setError("Choose the BDE to give it to.");
    const rows =
      tab === "single"
        ? [{ leadName: name.trim() || null, phone: phone.trim(), note: note.trim() || null }]
        : parsed.rows.map((r) => ({ leadName: r.leadName, phone: r.phone, note: note.trim() || null }));
    if (tab === "single" && !phone.trim()) return setError("Enter the phone number.");
    if (rows.length === 0) return setError("Paste at least one line with a phone number.");
    if (rows.length > MAX_HANDOVER_ROWS) return setError(`At most ${MAX_HANDOVER_ROWS} at a time.`);
    setBusy(true);
    try {
      const r = await save(channel, bde, rows);
      setResult(r);
      if (r.saved.length) {
        setName("");
        setPhone("");
        setNote("");
        setPaste("");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <h2 className="text-h3 text-on-surface">New handover</h2>
        <div className="flex gap-xs" role="tablist" aria-label="How to add">
          <button type="button" role="tab" aria-selected={tab === "single"} className={tabCls(tab === "single")} onClick={() => setTab("single")}>
            One lead
          </button>
          <button type="button" role="tab" aria-selected={tab === "bulk"} className={tabCls(tab === "bulk")} onClick={() => setTab("bulk")}>
            Paste a list
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-md md:grid-cols-2">
        <ChannelAndBde channel={channel} setChannel={setChannel} bde={bde} setBde={setBde} bdes={bdes} idPrefix={tab} />
      </div>

      {tab === "single" ? (
        <div className="grid grid-cols-1 gap-md md:grid-cols-2">
          <Field label="Name" htmlFor="ho-name">
            <input id="ho-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Phone *" htmlFor="ho-phone">
            <input id="ho-phone" className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          </Field>
        </div>
      ) : (
        <div className="space-y-sm">
          <Field label="Paste — one lead per line: name, phone (or copy two columns from a sheet)" htmlFor="ho-paste">
            <textarea
              id="ho-paste"
              className={`${inputCls} font-mono`}
              rows={6}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={"Name, 98765 43210\nName\t+91 91234 56780"}
            />
          </Field>
          {paste.trim() && (
            <p className="text-label-sm text-on-surface-variant">
              {parsed.rows.length} lead{parsed.rows.length === 1 ? "" : "s"} ready
              {parsed.errors.length > 0 && (
                <span className="text-error">
                  {" "}
                  · {parsed.errors.length} line{parsed.errors.length === 1 ? "" : "s"} skipped:{" "}
                  {parsed.errors.map((e) => `line ${e.line} (${e.reason.toLowerCase()})`).join(", ")}
                </span>
              )}
            </p>
          )}
        </div>
      )}

      <Field label={tab === "single" ? "Note (optional)" : "Note for all of them (optional)"} htmlFor="ho-note">
        <input id="ho-note" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. asked about NCLEX in the comments" />
      </Field>

      {error && <p className="text-label-sm font-semibold text-error">{error}</p>}
      {result && <ResultLine result={result} />}
      <button type="button" className={primaryBtn} onClick={submit} disabled={busy}>
        {busy ? "Saving…" : tab === "single" ? "Save handover" : `Save ${parsed.rows.length || ""} handover${parsed.rows.length === 1 ? "" : "s"}`}
      </button>
    </section>
  );
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  overdue: "Overdue",
  created: "Created",
  duplicate: "Duplicate",
  rejected: "Rejected",
};

/** Day, "still open", status chips, source and BDE — kept in the URL like the other CRM lists. */
export function HandoverFilters({
  today,
  date,
  withOpen,
  statuses,
  channel,
  bde,
  bdes,
}: {
  today: string;
  date: string;
  withOpen: boolean;
  statuses: string[];
  channel: string;
  bde: string;
  bdes: Bde[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  function go(patch: Record<string, string | string[] | null>) {
    const params = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) {
      params.delete(k);
      if (Array.isArray(v)) v.forEach((x) => params.append(k, x));
      else if (v) params.set(k, v);
    }
    router.push(params.toString() ? `${pathname}?${params}` : pathname);
  }
  const toggle = (s: string) => go({ status: statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s] });

  return (
    <div className="flex flex-wrap items-center gap-sm">
      <input
        type="date"
        className={controlCls}
        value={date}
        max={today}
        onChange={(e) => go({ date: e.target.value || today })}
        aria-label="Day given"
      />
      <label className="inline-flex items-center gap-xs text-label-sm text-on-surface">
        <input type="checkbox" checked={withOpen} onChange={(e) => go({ open: e.target.checked ? null : "0" })} />
        plus still open from earlier days
      </label>
      <div className="flex flex-wrap gap-xs" aria-label="Status">
        {HANDOVER_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={statuses.includes(s)}
            onClick={() => toggle(s)}
            className={`h-8 rounded-full border px-md text-label-sm font-semibold ${
              statuses.includes(s) ? "border-primary bg-primary text-on-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low"
            }`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      <select className={controlCls} value={channel} onChange={(e) => go({ channel: e.target.value || null })} aria-label="Source">
        <option value="">All sources</option>
        {HANDOVER_CHANNELS.map((c) => (
          <option key={c.code} value={c.code}>
            {c.label}
          </option>
        ))}
      </select>
      {bdes.length > 0 && (
        <select className={controlCls} value={bde} onChange={(e) => go({ bde: e.target.value || null })} aria-label="BDE">
          <option value="">All BDEs</option>
          {bdes.map((b) => (
            <option key={b.userId} value={b.userId}>
              {b.displayName}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
