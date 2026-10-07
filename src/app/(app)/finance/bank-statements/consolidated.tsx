"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Section } from "@/components/Cards";
import type { Consolidated } from "@/lib/bank/queries";
import type { UploadResult } from "@/lib/bank/engine";
import { Notice, StatusChip, day, inputCls, money, primaryBtn, secondaryBtn, td, th } from "./_ui";

type FileState =
  | { name: string; state: "waiting" | "uploading" }
  | { name: string; state: "done"; result: UploadResult }
  | { name: string; state: "error"; code: string; message: string };

/**
 * Drop one or many statement PDFs. Each is read for its bank and account,
 * imported, and reported on — new transactions vs ones already in DesGro —
 * one request per file so a bad file never sinks the rest.
 */
export function StatementUploader({ integrationId }: { integrationId: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileState[]>([]);
  const [pending, setPending] = useState<File[]>([]);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  const upload = async (list: File[]) => {
    const pdfs = list.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (!pdfs.length) return;
    setBusy(true);
    setPending([]);
    setFiles((prev) => [...prev.filter((p) => !pdfs.some((f) => f.name === p.name)), ...pdfs.map((f) => ({ name: f.name, state: "waiting" as const }))]);
    const set = (name: string, s: FileState) => setFiles((prev) => prev.map((p) => (p.name === name ? s : p)));
    const retry: File[] = [];
    let account: string | null = null;
    for (const f of pdfs) {
      set(f.name, { name: f.name, state: "uploading" });
      try {
        const fd = new FormData();
        fd.set("file", f);
        if (integrationId) fd.set("integrationId", integrationId);
        if (password) fd.set("password", password);
        const res = await fetch("/api/finance/bank-statements/upload", { method: "POST", body: fd });
        const data = (await res.json().catch(() => ({}))) as UploadResult & { error?: string; message?: string };
        if (!res.ok) {
          if (data.error === "PDF_PASSWORD") retry.push(f);
          set(f.name, { name: f.name, state: "error", code: data.error ?? "error", message: data.message ?? "Upload failed" });
        } else {
          account ??= data.integrationId;
          set(f.name, { name: f.name, state: "done", result: data });
        }
      } catch {
        set(f.name, { name: f.name, state: "error", code: "network", message: "Network error — try again" });
      }
    }
    setPending(retry);
    setBusy(false);
    if (account && account !== search.get("account")) {
      router.push(`${pathname}?tab=consolidated&account=${account}`);
    }
    router.refresh();
  };

  const totals = files.reduce(
    (t, f) => (f.state === "done" ? { inserted: t.inserted + f.result.inserted, dup: t.dup + f.result.duplicates } : t),
    { inserted: 0, dup: 0 },
  );

  return (
    <Section title="Upload statements">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!busy) void upload(Array.from(e.dataTransfer.files));
        }}
        className={`flex flex-col items-center justify-center gap-sm rounded-xl border-2 border-dashed p-lg text-center transition ${
          drag ? "border-primary bg-primary/5" : "border-outline-variant bg-surface-container-low"
        }`}
      >
        <span className="material-symbols-outlined text-[36px] text-on-surface-variant">upload_file</span>
        <p className="text-body-md">
          Drop statement PDFs here, or{" "}
          <button type="button" className="text-primary font-semibold underline" disabled={busy} onClick={() => input.current?.click()}>
            choose files
          </button>
        </p>
        <p className="text-caption text-on-surface-variant max-w-xl">
          Daily, monthly or any period — upload as many as you like, in any order, even overlapping. The account is read from each PDF, and a
          transaction already in DesGro is never added twice.
        </p>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = "";
            void upload(list);
          }}
        />
      </div>

      <div className="mt-md grid md:grid-cols-[1fr_auto] gap-sm items-end">
        <label className="space-y-xs">
          <span className="text-label-sm font-semibold">PDF password (only if the statement is password-protected)</span>
          <input
            type="password"
            autoComplete="off"
            className={inputCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Used for this upload only — not saved"
          />
        </label>
        {pending.length > 0 && (
          <button type="button" className={primaryBtn} disabled={busy || !password} onClick={() => upload(pending)}>
            Retry {pending.length} locked file{pending.length === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {files.length > 0 && (
        <div className="mt-md space-y-sm">
          {!busy && (totals.inserted > 0 || totals.dup > 0) && (
            <Notice tone="ok">
              {totals.inserted} new transaction{totals.inserted === 1 ? "" : "s"} added
              {totals.dup ? ` · ${totals.dup} already in DesGro were skipped` : ""}.
            </Notice>
          )}
          <ul className="divide-y divide-outline-variant border border-outline-variant rounded-lg">
            {files.map((f) => (
              <li key={f.name} className="flex flex-wrap items-center gap-sm px-md py-sm text-body-md">
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant">picture_as_pdf</span>
                <span className="font-semibold truncate max-w-[260px]" title={f.name}>
                  {f.name}
                </span>
                <span className="flex-1" />
                {f.state === "waiting" && <span className="text-on-surface-variant">Waiting…</span>}
                {f.state === "uploading" && (
                  <span className="flex items-center gap-xs text-on-surface-variant">
                    <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>Reading…
                  </span>
                )}
                {f.state === "error" && <span className="text-red-700 max-w-[480px]">{f.message}</span>}
                {f.state === "done" && (
                  <>
                    <span className="text-on-surface-variant">
                      {f.result.account} · {f.result.periodStart === f.result.periodEnd ? day(f.result.periodEnd) : `${day(f.result.periodStart)} → ${day(f.result.periodEnd)}`}
                    </span>
                    <StatusChip status={f.result.duplicate ? "DUPLICATE" : f.result.status} title={f.result.lastError ?? f.result.errors[0]} />
                    <span className="text-on-surface-variant">
                      {f.result.duplicate
                        ? "This file was already imported"
                        : f.result.status === "REVIEW_REQUIRED"
                          ? `Held for review: ${f.result.errors[0] ?? ""}`
                          : `${f.result.inserted} new · ${f.result.duplicates} already present`}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

export function ConsolidatedView({ data, canDownload }: { data: Consolidated; canDownload: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [from, setFrom] = useState(search.get("from") ?? "");
  const [to, setTo] = useState(search.get("to") ?? "");
  const s = data.summary;
  const breakIds = new Set(s.breaks.map((b) => b.id));

  const go = (f: string, t: string) => {
    const p = new URLSearchParams();
    p.set("tab", "consolidated");
    const a = search.get("account");
    if (a) p.set("account", a);
    if (f) p.set("from", f);
    if (t) p.set("to", t);
    router.push(`${pathname}?${p.toString()}`);
  };
  const exportUrl = (format: string) => {
    const p = new URLSearchParams({ format });
    const a = search.get("account");
    if (a) p.set("account", a);
    if (search.get("from")) p.set("from", search.get("from")!);
    if (search.get("to")) p.set("to", search.get("to")!);
    return `/api/finance/bank-transactions?${p.toString()}`;
  };

  if (data.total === 0) {
    return (
      <Section title="Consolidated statement">
        <p className="py-lg text-center text-on-surface-variant">
          No transactions {search.get("from") || search.get("to") ? "in this date range" : "yet"}. Upload statement PDFs above to build the consolidated
          statement.
        </p>
      </Section>
    );
  }

  return (
    <div className="space-y-md">
      <section className="grid grid-cols-2 lg:grid-cols-6 gap-gutter">
        <Tile label="Period" value={s.firstDate === s.lastDate ? day(s.firstDate) : `${day(s.firstDate)} → ${day(s.lastDate)}`} small />
        <Tile label="Opening balance" value={money(s.opening)} />
        <Tile label="Total credits" value={money(s.totalCredit)} tone="text-green-700" />
        <Tile label="Total debits" value={money(s.totalDebit)} tone="text-error" />
        <Tile label="Closing balance" value={money(s.closing)} />
        <Tile label="Transactions" value={data.total.toLocaleString("en-IN")} hint={`from ${data.statementsCount} statement${data.statementsCount === 1 ? "" : "s"}`} />
      </section>

      {!data.truncated &&
        (s.breaks.length === 0 && s.gaps.length === 0 ? (
          <Notice tone="ok">
            Complete and continuous — every day in this period is covered, and opening + credits − debits equals the closing balance.
          </Notice>
        ) : (
          <Notice tone="warn">
            {s.gaps.length > 0 && (
              <div>
                <b>Not covered by any uploaded statement:</b>{" "}
                {s.gaps.map((g) => (g.start === g.end ? day(g.start) : `${day(g.start)} → ${day(g.end)}`)).join(", ")}
              </div>
            )}
            {s.breaks.length > 0 && (
              <div className={s.gaps.length ? "mt-xs" : ""}>
                <b>Balance does not continue at {s.breaks.length} point{s.breaks.length === 1 ? "" : "s"}</b> — transactions are probably missing
                before: {s.breaks.slice(0, 6).map((b) => `${day(b.date)} (expected ${money(b.expected)}, statement shows ${money(b.actual)})`).join("; ")}
                {s.breaks.length > 6 ? "…" : ""}. Upload the statement covering those days.
              </div>
            )}
          </Notice>
        ))}

      <Section
        title="Consolidated statement"
        action={
          <div className="flex flex-wrap items-end gap-sm print:hidden">
            <input type="date" aria-label="From" className={`${inputCls} h-9 w-[150px]`} value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" aria-label="To" className={`${inputCls} h-9 w-[150px]`} value={to} onChange={(e) => setTo(e.target.value)} />
            <button type="button" className={secondaryBtn} onClick={() => go(from, to)}>
              Apply
            </button>
            {(search.get("from") || search.get("to")) && (
              <button
                type="button"
                className={secondaryBtn}
                onClick={() => {
                  setFrom("");
                  setTo("");
                  go("", "");
                }}
              >
                All dates
              </button>
            )}
            {canDownload && (
              <>
                <a className={primaryBtn} href={exportUrl("xlsx")}>
                  <span className="material-symbols-outlined text-[18px]">download</span>Excel
                </a>
                <a className={secondaryBtn} href={exportUrl("csv")}>
                  CSV
                </a>
              </>
            )}
            <button type="button" className={secondaryBtn} onClick={() => window.print()}>
              <span className="material-symbols-outlined text-[18px]">print</span>Print / PDF
            </button>
          </div>
        }
      >
        {data.truncated && (
          <div className="mb-md">
            <Notice tone="warn">
              Showing the first {data.rows.length.toLocaleString("en-IN")} of {data.total.toLocaleString("en-IN")} transactions — narrow the dates, or
              download Excel for all of them.
            </Notice>
          </div>
        )}
        <div className="overflow-x-auto -mx-lg">
          <table className="w-full text-body-md">
            <thead className="bg-surface-container text-on-surface-variant text-caption uppercase tracking-wide">
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Narration</th>
                <th className={`${th} hidden md:table-cell`}>Chq./Ref. No.</th>
                <th className={`${th} hidden lg:table-cell`}>Value date</th>
                <th className={`${th} text-right`}>Withdrawal</th>
                <th className={`${th} text-right`}>Deposit</th>
                <th className={`${th} text-right`}>Closing balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              <tr className="bg-surface-container-low">
                <td className={`${td} whitespace-nowrap`}>{day(s.firstDate)}</td>
                <td className={`${td} font-semibold`} colSpan={5}>
                  Opening balance
                </td>
                <td className={`${td} text-right font-semibold whitespace-nowrap`}>{money(s.opening)}</td>
              </tr>
              {data.rows.map((r) => (
                <tr key={r.id} className={breakIds.has(r.id) ? "bg-amber-50" : "hover:bg-surface-container-low"}>
                  <td className={`${td} whitespace-nowrap`}>{day(r.txnDate)}</td>
                  <td className={`${td} min-w-[240px]`}>
                    <div className="break-words">{r.description}</div>
                    {breakIds.has(r.id) && <div className="text-caption text-amber-800">Balance gap before this row — a statement may be missing</div>}
                  </td>
                  <td className={`${td} hidden md:table-cell text-data-mono text-caption break-all`}>{r.reference ?? ""}</td>
                  <td className={`${td} hidden lg:table-cell whitespace-nowrap text-on-surface-variant`}>{day(r.valueDate)}</td>
                  <td className={`${td} text-right whitespace-nowrap text-error`}>{r.debit ? money(r.debit) : ""}</td>
                  <td className={`${td} text-right whitespace-nowrap text-green-700`}>{r.credit ? money(r.credit) : ""}</td>
                  <td className={`${td} text-right whitespace-nowrap`}>{money(r.balance)}</td>
                </tr>
              ))}
              <tr className="bg-surface-container-low font-semibold">
                <td className={td} colSpan={2}>
                  Totals · closing balance
                </td>
                <td className={`${td} hidden md:table-cell`} />
                <td className={`${td} hidden lg:table-cell`} />
                <td className={`${td} text-right whitespace-nowrap text-error`}>{money(s.totalDebit)}</td>
                <td className={`${td} text-right whitespace-nowrap text-green-700`}>{money(s.totalCredit)}</td>
                <td className={`${td} text-right whitespace-nowrap`}>{money(s.closing)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function Tile({ label, value, hint, tone, small }: { label: string; value: string; hint?: string; tone?: string; small?: boolean }) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-md">
      <div className="text-caption uppercase tracking-wide text-on-surface-variant font-semibold">{label}</div>
      <div className={`${small ? "text-body-lg" : "text-h3"} font-bold mt-xs ${tone ?? "text-on-surface"}`}>{value}</div>
      {hint && <div className="text-caption text-on-surface-variant mt-xs">{hint}</div>}
    </div>
  );
}
