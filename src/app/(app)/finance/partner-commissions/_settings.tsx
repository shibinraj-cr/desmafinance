"use client";

import { useState } from "react";
import { Callout, Field, Icon, ProgramTag, api, btnCls, cardCls, inputCls, linkBtnCls, primaryBtnCls } from "@/components/partner-commissions/ui";
import { LEDGER, PROGRAM_CODES } from "@/lib/partner-commissions/constants";
import { suggestInvoiceNumber } from "@/lib/partner-commissions/logic";
import type { PartnerDTO, ProgramDTO } from "./_types";
import type { PcCtx } from "./client";

const URL_SETTINGS = "/api/finance/partner-commissions/settings";

export function SettingsTab({ ctx }: { ctx: PcCtx }) {
  const ro = !ctx.data.canApprove;
  return (
    <div className="flex flex-col gap-md">
      {ro ? <Callout icon="lock">View only. A Finance Manager or Admin changes these settings.</Callout> : null}
      <PartnersCard ctx={ctx} ro={ro} />
      <ProgramsCard ctx={ctx} ro={ro} />
      {!ro ? <AccessCard ctx={ctx} /> : null}
      <div className="grid gap-md grid-cols-[repeat(auto-fit,minmax(340px,1fr))]">
        <IssuerCard ctx={ctx} ro={ro} />
        <RunCard ctx={ctx} ro={ro} />
      </div>
      <div className={`${cardCls} p-md flex flex-col gap-sm`}>
        <h4 className="font-semibold text-body-lg">Revenue posting</h4>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-md gap-y-1.5 text-body-md">
          <dt className="text-on-surface-variant">Type</dt><dd>{LEDGER.type}</dd>
          <dt className="text-on-surface-variant">Category</dt><dd>{LEDGER.category}</dd>
          <dt className="text-on-surface-variant">Sub-items</dt><dd>{PROGRAM_CODES.map((c) => LEDGER.subItem(c)).join(" · ")}</dd>
          <dt className="text-on-surface-variant">Payment mode</dt><dd>{LEDGER.paymentMode}</dd>
          <dt className="text-on-surface-variant">EXP / DOM</dt><dd>{LEDGER.expDom}</dd>
          <dt className="text-on-surface-variant">Party</dt><dd>The partner&apos;s party (created as a Vendor party on first posting if none matches its name)</dd>
          <dt className="text-on-surface-variant">Date</dt><dd>The day the AED reached Wio</dd>
        </dl>
        <p className="text-caption text-on-surface-variant">Weekly P&amp;L, the Sales Objective and Sales Analysis already count Revenue › Commissions.</p>
      </div>
    </div>
  );
}

function useSaver(ctx: PcCtx) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save(body: Record<string, unknown>, msg: string): Promise<boolean> {
    setErr(null);
    setBusy(true);
    try {
      await api(URL_SETTINGS, body);
      ctx.done(msg);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, err, save };
}

// ── partners ─────────────────────────────────────────────────────────────────

function PartnersCard({ ctx, ro }: { ctx: PcCtx; ro: boolean }) {
  const [editing, setEditing] = useState<PartnerDTO | "new" | null>(null);
  const { partners } = ctx.data;
  return (
    <div className={`${cardCls} p-md flex flex-col gap-sm`}>
      <div className="flex justify-between items-center gap-sm">
        <h4 className="font-semibold text-body-lg">Partners</h4>
        {!ro && !editing ? <button className={btnCls} onClick={() => setEditing("new")}><Icon name="add" />Add partner</button> : null}
      </div>
      {partners.length === 0 && !editing ? <p className="text-body-md text-on-surface-variant">No partners yet. Add each institution DESMA invoices for commission.</p> : null}
      {partners.map((p) =>
        editing !== "new" && editing?.id === p.id ? (
          <PartnerForm key={p.id} ctx={ctx} partner={p} onDone={() => setEditing(null)} />
        ) : (
          <div key={p.id} className="border border-outline-variant rounded-lg px-sm py-2 flex flex-wrap gap-x-md gap-y-1 items-start">
            <div className="flex-1 min-w-[220px]">
              <b>{p.name}</b>{!p.isActive ? <span className="text-caption text-on-surface-variant"> · inactive</span> : null}
              <div className="text-caption text-on-surface-variant whitespace-pre-line">{[p.address, p.email, p.forLine ? `FOR: ${p.forLine}` : null].filter(Boolean).join("\n")}</div>
            </div>
            <span className="text-caption text-on-surface-variant">{p.layout === "detailed" ? "Student ID and Course columns" : "Program in the description"}</span>
            {!ro && !editing ? <button className={linkBtnCls} onClick={() => setEditing(p)}>Edit</button> : null}
          </div>
        ),
      )}
      {editing === "new" ? <PartnerForm ctx={ctx} partner={null} onDone={() => setEditing(null)} /> : null}
    </div>
  );
}

function PartnerForm({ ctx, partner, onDone }: { ctx: PcCtx; partner: PartnerDTO | null; onDone: () => void }) {
  const [name, setName] = useState(partner?.name ?? "");
  const [address, setAddress] = useState(partner?.address ?? "");
  const [email, setEmail] = useState(partner?.email ?? "");
  const [forLine, setForLine] = useState(partner?.forLine ?? "");
  const [layout, setLayout] = useState(partner?.layout ?? "compact");
  const [active, setActive] = useState(partner?.isActive ?? true);
  const { busy, err, save } = useSaver(ctx);
  return (
    <div className="border border-primary-container bg-primary-fixed/20 rounded-lg p-sm flex flex-col gap-sm">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-sm">
        <Field label="Partner name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Email (printed under the address)"><input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Address"><textarea className={`${inputCls} !h-auto py-2`} rows={3} value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <div className="flex flex-col gap-sm">
          <Field label='"For" line (optional)'><input className={inputCls} value={forLine} onChange={(e) => setForLine(e.target.value)} placeholder="e.g. Commission Payment" /></Field>
          <Field label="Invoice layout">
            <select className={inputCls} value={layout} onChange={(e) => setLayout(e.target.value)}>
              <option value="compact">Program in the description (Name | OSCE | Full Fee Paid)</option>
              <option value="detailed">Student ID and Course columns</option>
            </select>
          </Field>
        </div>
      </div>
      <label className="flex items-center gap-2 text-body-md"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Active</label>
      {err ? <p className="text-body-md text-error font-medium">{err}</p> : null}
      <div className="flex gap-2 justify-end">
        <button className={btnCls} onClick={onDone} disabled={busy}>Cancel</button>
        <button
          className={primaryBtnCls}
          disabled={busy}
          onClick={async () => {
            if (await save({ action: "partner", id: partner?.id ?? null, name, address, email: email || null, forLine: forLine || null, layout, isActive: active }, partner ? "Partner saved." : `${name} added.`)) onDone();
          }}
        >
          Save partner
        </button>
      </div>
    </div>
  );
}

// ── programs ─────────────────────────────────────────────────────────────────

function ProgramsCard({ ctx, ro }: { ctx: PcCtx; ro: boolean }) {
  return (
    <div className={`${cardCls} p-md flex flex-col gap-sm`}>
      <h4 className="font-semibold text-body-lg">Programs</h4>
      <p className="text-caption text-on-surface-variant">Which partner runs each program, and the defaults a new enrollment starts with. Each enrollment can still carry its own fee and %.</p>
      {ctx.data.partners.length === 0 ? <Callout icon="info">Add a partner first.</Callout> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-body-md">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-on-surface-variant">
              <th className="py-2 pr-sm font-semibold">Program</th><th className="py-2 pr-sm font-semibold">Partner</th><th className="py-2 pr-sm font-semibold">Course name on invoice</th>
              <th className="py-2 pr-sm font-semibold">Default fee (AUD)</th><th className="py-2 pr-sm font-semibold">Commission %</th><th className="py-2 pr-sm font-semibold">Active</th><th />
            </tr>
          </thead>
          <tbody>{ctx.data.programs.map((p) => <ProgramRow key={p.code} ctx={ctx} p={p} ro={ro} />)}</tbody>
        </table>
      </div>
    </div>
  );
}

function ProgramRow({ ctx, p, ro }: { ctx: PcCtx; p: ProgramDTO; ro: boolean }) {
  const [partnerId, setPartnerId] = useState(p.partnerId ?? "");
  const [course, setCourse] = useState(p.configured ? p.courseName : p.code === "GCAN" ? "GCAN Online" : p.code);
  const [fee, setFee] = useState(p.defaultFee != null ? String(p.defaultFee) : "");
  const [pct, setPct] = useState(p.defaultPct != null ? String(p.defaultPct) : "");
  const [active, setActive] = useState(p.configured ? p.isActive : true);
  const { busy, err, save } = useSaver(ctx);
  const dirty =
    !p.configured ||
    partnerId !== (p.partnerId ?? "") ||
    course !== p.courseName ||
    fee !== (p.defaultFee != null ? String(p.defaultFee) : "") ||
    pct !== (p.defaultPct != null ? String(p.defaultPct) : "") ||
    active !== p.isActive;
  return (
    <>
      <tr className="border-t border-outline-variant/60 align-top">
        <td className="py-2 pr-sm"><ProgramTag code={p.code} />{!p.configured ? <div className="text-caption text-amber-700 mt-1">Not set up</div> : null}</td>
        <td className="py-2 pr-sm">
          <select className={inputCls} value={partnerId} disabled={ro} onChange={(e) => setPartnerId(e.target.value)}>
            <option value="">Choose…</option>
            {ctx.data.partners.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </td>
        <td className="py-2 pr-sm"><input className={inputCls} value={course} disabled={ro} onChange={(e) => setCourse(e.target.value)} /></td>
        <td className="py-2 pr-sm"><input className={`${inputCls} !w-28`} type="number" min={1} value={fee} disabled={ro} onChange={(e) => setFee(e.target.value)} /></td>
        <td className="py-2 pr-sm"><input className={`${inputCls} !w-24`} type="number" min={0} max={100} step="0.5" value={pct} disabled={ro} onChange={(e) => setPct(e.target.value)} /></td>
        <td className="py-2 pr-sm"><input type="checkbox" className="mt-3" checked={active} disabled={ro} onChange={(e) => setActive(e.target.checked)} aria-label={`${p.code} active`} /></td>
        <td className="py-2">
          {!ro ? (
            <button
              className={btnCls}
              disabled={busy || !dirty || !partnerId}
              onClick={() => save({ action: "program", code: p.code, partnerId, courseName: course, defaultFee: fee ? parseFloat(fee) : null, defaultPct: pct ? parseFloat(pct) : null, isActive: active }, `${p.code} saved.`)}
            >
              Save
            </button>
          ) : null}
        </td>
      </tr>
      {err ? <tr><td colSpan={7} className="pb-2 text-body-md text-error font-medium">{err}</td></tr> : null}
    </>
  );
}

// ── who can add enrollments ──────────────────────────────────────────────────

function AccessCard({ ctx }: { ctx: PcCtx }) {
  const { data } = ctx;
  const [bde, setBde] = useState<string[]>(data.settings.bdePrograms);
  const [userId, setUserId] = useState("");
  const [progs, setProgs] = useState<string[]>([]);
  const { busy, err, save } = useSaver(ctx);
  const bdeDirty = [...bde].sort().join() !== [...data.settings.bdePrograms].sort().join();
  const toggle = (list: string[], code: string, on: boolean) => (on ? [...new Set([...list, code])] : list.filter((c) => c !== code));
  const grantedIds = new Set(data.grants.map((g) => g.userId));
  return (
    <div className={`${cardCls} p-md flex flex-col gap-sm`}>
      <h4 className="font-semibold text-body-lg">Who can add enrollments and record installments</h4>
      <p className="text-caption text-on-surface-variant">
        Finance (anyone with this page) can do everything. The people below get a <b>Partner Enrollments</b> page in CRM where they add enrollments for their programs and record each fee installment as it&apos;s paid; Finance invoices once the fee is fully paid. A BDE tracks the candidates they added or whose CRM lead is assigned to them; a person given a program here tracks every enrollment in it.
      </p>
      <div className="border border-outline-variant rounded-lg p-sm flex flex-wrap items-center gap-md">
        <div className="flex-1 min-w-[220px]"><b>All BDEs</b> <span className="text-caption text-on-surface-variant">· every active L1/L2 consultant on the Lead Pulse roster ({data.bdeCount} now)</span></div>
        {PROGRAM_CODES.map((c) => (
          <label key={c} className="flex items-center gap-1.5 text-body-md"><input type="checkbox" checked={bde.includes(c)} onChange={(e) => setBde(toggle(bde, c, e.target.checked))} />{c}</label>
        ))}
        <button className={btnCls} disabled={busy || !bdeDirty} onClick={() => save({ action: "settings", bdePrograms: bde }, "BDE access saved.")}>Save</button>
      </div>
      {data.grants.map((g) => <GrantRow key={g.userId} ctx={ctx} grant={g} />)}
      <div className="border border-dashed border-outline-variant rounded-lg p-sm flex flex-wrap items-end gap-md">
        <Field label="Give a person access" className="flex-1 min-w-[220px]">
          <select className={inputCls} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Choose a user…</option>
            {data.users.filter((u) => !grantedIds.has(u.id)).map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
        </Field>
        {PROGRAM_CODES.map((c) => (
          <label key={c} className="flex items-center gap-1.5 text-body-md h-10"><input type="checkbox" checked={progs.includes(c)} onChange={(e) => setProgs(toggle(progs, c, e.target.checked))} />{c}</label>
        ))}
        <button
          className={primaryBtnCls}
          disabled={busy || !userId || progs.length === 0}
          onClick={async () => {
            if (await save({ action: "grant", userId, programs: progs }, "Access given.")) {
              setUserId("");
              setProgs([]);
            }
          }}
        >
          Give access
        </button>
      </div>
      {err ? <p className="text-body-md text-error font-medium">{err}</p> : null}
    </div>
  );
}

function GrantRow({ ctx, grant }: { ctx: PcCtx; grant: { userId: string; username: string; programs: string[] } }) {
  const [progs, setProgs] = useState(grant.programs);
  const { busy, err, save } = useSaver(ctx);
  const dirty = [...progs].sort().join() !== [...grant.programs].sort().join();
  return (
    <div className="border border-outline-variant rounded-lg p-sm flex flex-wrap items-center gap-md">
      <b className="flex-1 min-w-[220px]">{grant.username}</b>
      {PROGRAM_CODES.map((c) => (
        <label key={c} className="flex items-center gap-1.5 text-body-md"><input type="checkbox" checked={progs.includes(c)} onChange={(e) => setProgs(e.target.checked ? [...progs, c] : progs.filter((x) => x !== c))} />{c}</label>
      ))}
      <button className={btnCls} disabled={busy || !dirty} onClick={() => save({ action: "grant", userId: grant.userId, programs: progs }, progs.length ? "Access saved." : `Access removed for ${grant.username}.`)}>Save</button>
      <button className={`${linkBtnCls} !text-error`} disabled={busy} onClick={() => save({ action: "grant", userId: grant.userId, programs: [] }, `Access removed for ${grant.username}.`)}>Remove</button>
      {err ? <p className="basis-full text-body-md text-error font-medium">{err}</p> : null}
    </div>
  );
}

// ── issuer, bank, signature ──────────────────────────────────────────────────

function IssuerCard({ ctx, ro }: { ctx: PcCtx; ro: boolean }) {
  const s = ctx.data.settings;
  const [f, setF] = useState({
    issuerName: s.issuerName,
    issuerAddress: s.issuerAddress,
    issuerRegLine: s.issuerRegLine,
    bankAccountName: s.bankAccountName,
    bankCurrency: s.bankCurrency,
    bankIban: s.bankIban,
    bankBic: s.bankBic,
    bankAccountNo: s.bankAccountNo,
    signatoryName: s.signatoryName,
  });
  const { busy, err, save } = useSaver(ctx);
  const [sigBusy, setSigBusy] = useState(false);
  const [sigErr, setSigErr] = useState<string | null>(null);
  const [sigVersion, setSigVersion] = useState(0);
  const dirty = (Object.keys(f) as Array<keyof typeof f>).some((k) => f[k] !== s[k]);
  const input = (k: keyof typeof f, label: string, placeholder?: string) => (
    <Field label={label}><input className={inputCls} value={f[k]} disabled={ro} placeholder={placeholder} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
  );

  async function upload(file: File) {
    setSigErr(null);
    setSigBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${URL_SETTINGS}/signature`, { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(j.message || "Couldn't upload the signature.");
      setSigVersion((v) => v + 1);
      ctx.done("Signature saved.");
    } catch (e) {
      setSigErr(e instanceof Error ? e.message : "Couldn't upload the signature.");
    } finally {
      setSigBusy(false);
    }
  }

  return (
    <div className={`${cardCls} p-md flex flex-col gap-sm`}>
      <h4 className="font-semibold text-body-lg">Invoice issuer, bank and signature</h4>
      {input("issuerName", "Company name", "e.g. DESMA International LLC")}
      {input("issuerAddress", "Address line")}
      {input("issuerRegLine", "Registration line", "Formation No: … | License No: …")}
      <div className="grid grid-cols-2 gap-sm">
        {input("bankAccountName", "Bank account name")}
        {input("bankCurrency", "Account currency")}
      </div>
      {input("bankIban", "IBAN")}
      <div className="grid grid-cols-2 gap-sm">
        {input("bankBic", "BIC/SWIFT")}
        {input("bankAccountNo", "Account number")}
      </div>
      {input("signatoryName", "Signatory name", "Printed under the signature")}
      <Field label="Signature image">
        <div className="flex items-center gap-sm flex-wrap">
          <div className="h-14 w-40 border border-dashed border-outline-variant rounded-lg bg-white grid place-items-center overflow-hidden">
            {s.hasSignature ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${URL_SETTINGS}/signature?v=${sigVersion}`} alt="Signature on invoices" className="max-h-12 max-w-[150px]" />
            ) : (
              <span className="text-caption text-on-surface-variant">None yet</span>
            )}
          </div>
          {!ro ? (
            <>
              <label className={`${btnCls} cursor-pointer`}>
                <Icon name="upload" />{s.hasSignature ? "Replace" : "Upload"}
                <input type="file" accept="image/png,image/jpeg" className="sr-only" disabled={sigBusy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              </label>
              {s.hasSignature ? (
                <button className={`${linkBtnCls} !text-error`} disabled={sigBusy} onClick={async () => { await fetch(`${URL_SETTINGS}/signature`, { method: "DELETE" }); ctx.done("Signature removed."); }}>Remove</button>
              ) : null}
            </>
          ) : null}
        </div>
      </Field>
      <p className="text-caption text-on-surface-variant">PNG with a transparent background looks best, under 400 KB. These details are kept in DesGro&apos;s database, not in the code.</p>
      {sigErr ? <p className="text-body-md text-error font-medium">{sigErr}</p> : null}
      {err ? <p className="text-body-md text-error font-medium">{err}</p> : null}
      {!ro ? <div className="flex justify-end"><button className={primaryBtnCls} disabled={busy || !dirty} onClick={() => save({ action: "settings", ...f }, "Invoice details saved.")}>Save</button></div> : null}
    </div>
  );
}

function RunCard({ ctx, ro }: { ctx: PcCtx; ro: boolean }) {
  const s = ctx.data.settings;
  const existing = ctx.data.invoices.map((i) => i.number);
  // What DesGro will suggest next: one above the last DesGro invoice, but never below the saved floor.
  const suggested = suggestInvoiceNumber(s.numberPrefix, ctx.data.today, existing, s.nextNumber);
  const [prefix, setPrefix] = useState(s.numberPrefix);
  const [next, setNext] = useState(suggested);
  const [day, setDay] = useState(String(s.runDay));
  const [email, setEmail] = useState(s.emailAlerts);
  const { busy, err, save } = useSaver(ctx);
  const dirty = prefix !== s.numberPrefix || next.trim() !== suggested || day !== String(s.runDay) || email !== s.emailAlerts;
  return (
    <div className={`${cardCls} p-md flex flex-col gap-sm`}>
      <h4 className="font-semibold text-body-lg">Numbering and monthly run</h4>
      <div className="grid grid-cols-2 gap-sm">
        <Field label="Number prefix"><input className={inputCls} value={prefix} disabled={ro} onChange={(e) => setPrefix(e.target.value)} /></Field>
        <Field label="Financial year"><input className={inputCls} value="April to March (automatic)" disabled /></Field>
      </div>
      <Field
        label="Next invoice number"
        hint="Invoices raised outside DesGro share this series, so set the next free number here. DesGro won't suggest anything lower this financial year and moves on by itself as invoices are made; from April the new year starts at 001. Any number can still be changed on the invoice before payment."
      >
        <input className={`${inputCls} tabular-nums`} value={next} disabled={ro} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-sm">
        <Field label="Run on day (1–28)"><input className={inputCls} type="number" min={1} max={28} value={day} disabled={ro} onChange={(e) => setDay(e.target.value)} /></Field>
        <Field label="Time"><input className={inputCls} value="08:30 IST" disabled /></Field>
      </div>
      <label className="flex items-center gap-2 text-body-md"><input type="checkbox" checked={email} disabled={ro} onChange={(e) => setEmail(e.target.checked)} />Email the run&apos;s invoices to Finance Managers, Finance Executives and Admins</label>
      <p className="text-caption text-on-surface-variant">A notification goes to the same people either way, and payments waiting for approval also count on the Approvals badge.</p>
      {err ? <p className="text-body-md text-error font-medium">{err}</p> : null}
      {!ro ? <div className="flex justify-end"><button className={primaryBtnCls} disabled={busy || !dirty} onClick={() => save({ action: "settings", numberPrefix: prefix, ...(next.trim() !== suggested ? { nextNumber: next.trim() } : {}), runDay: parseInt(day, 10), emailAlerts: email }, "Saved.")}>Save</button></div> : null}
    </div>
  );
}
