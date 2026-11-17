"use client";

import { useState } from "react";
import { ENTITY_LABEL, GST_INVOICE_NO_MAX, INVOICE_ENTITIES, SERIES_LABEL, type InvoiceEntityCode, type SeriesKey } from "@/lib/invoices/core";
import { Callout, Field, Icon, api, btnCls, cardCls, inputCls, primaryBtnCls } from "@/components/partner-commissions/ui";
import type { InvoicesPageData } from "./client";

/**
 * Invoice settings: everything printed about the two companies, the bank
 * block per bank, the number series, and the day in-app invoicing starts.
 * All of it lives in the database only (the repository is public). Finance
 * can read it; a Finance Manager or admin edits it.
 */
export function SettingsTab({ data, done }: { data: InvoicesPageData; done: (m: string) => void }) {
  const ro = !data.canManage;
  return (
    <div className="flex flex-col gap-lg max-w-4xl">
      {ro ? <Callout icon="lock">Only a Finance Manager or admin can change these.</Callout> : null}
      <StartsOn data={data} done={done} ro={ro} />
      {INVOICE_ENTITIES.map((code) => (
        <EntityCard key={code} code={code} data={data} done={done} ro={ro} />
      ))}
      <BanksCard data={data} done={done} ro={ro} />
      <SeriesCard data={data} done={done} ro={ro} />
    </div>
  );
}

function useSave(done: (m: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(body: unknown, msg: string, url = "/api/finance/invoices/settings") {
    setBusy(true);
    setError(null);
    try {
      await api(url, body);
      done(msg);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, save, setError };
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className={`${cardCls} p-lg flex flex-col gap-sm`}>
      <div>
        <h3 className="text-h3 text-on-surface">{title}</h3>
        {sub ? <p className="text-caption text-on-surface-variant mt-0.5">{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

function StartsOn({ data, done, ro }: { data: InvoicesPageData; done: (m: string) => void; ro: boolean }) {
  const [value, setValue] = useState(data.settings.startsOn ?? "");
  const s = useSave(done);
  return (
    <Card title="In-app invoicing starts on" sub="Payments dated on or after this day are invoiced here. Agreed: the 1st of the month after this goes live.">
      <div className="flex flex-wrap gap-sm items-end">
        <Field label="Start date">
          <input type="date" className={inputCls} value={value} disabled={ro} onChange={(e) => setValue(e.target.value)} />
        </Field>
        {!ro && (
          <button className={primaryBtnCls} disabled={s.busy} onClick={() => s.save({ action: "startsOn", value: value || null }, "Start date saved.")}>
            Save
          </button>
        )}
      </div>
      {s.error ? <Callout tone="bad" icon="error">{s.error}</Callout> : null}
    </Card>
  );
}

function EntityCard({ code, data, done, ro }: { code: InvoiceEntityCode; data: InvoicesPageData; done: (m: string) => void; ro: boolean }) {
  const e = data.settings.entities.find((x) => x.code === code);
  const [f, setF] = useState({
    legalName: e?.legalName ?? "",
    headerLines: e?.headerLines ?? "",
    signFor: e?.signFor ?? "",
    thanksLine: e?.thanksLine ?? "",
    gstin: e?.gstin ?? "",
    sacCode: e?.sacCode ?? "",
    lutArn: e?.lutArn ?? "",
    note: e?.note ?? "",
    signatoryName: e?.signatoryName ?? "",
  });
  const s = useSave(done);
  const [sigVersion, setSigVersion] = useState(0);
  const set = (k: keyof typeof f) => (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: ev.target.value });
  const india = code === "DIPL";

  async function upload(file: File | null) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    s.setError(null);
    const res = await fetch(`/api/finance/invoices/settings/signature/${code}`, { method: "POST", body: form });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      s.setError(j.message ?? "Couldn't save the signature.");
      return;
    }
    setSigVersion((v) => v + 1);
    done("Signature saved.");
  }

  return (
    <Card title={ENTITY_LABEL[code]} sub={india ? "Axis and HDFC payments: D/DIPL and E/DIPL invoices." : "Wio payments: D/DLLC invoices."}>
      <div className="grid gap-sm sm:grid-cols-2">
        <Field label="Legal name" hint="Printed in capitals under the logo" className="sm:col-span-2">
          <input className={inputCls} value={f.legalName} disabled={ro} onChange={set("legalName")} />
        </Field>
        <Field label="Lines under the name" hint="Address; phone, email, website; registration numbers. One line each." className="sm:col-span-2">
          <textarea className={`${inputCls} h-24 py-2`} value={f.headerLines} disabled={ro} onChange={set("headerLines")} />
        </Field>
        {india && (
          <>
            <Field label="GSTIN" hint="Its first two digits set the home state (CGST + SGST there, IGST elsewhere)">
              <input className={inputCls} value={f.gstin} disabled={ro} onChange={set("gstin")} />
            </Field>
            <Field label="SAC code" hint="Printed in the HSN column">
              <input className={inputCls} value={f.sacCode} disabled={ro} onChange={set("sacCode")} />
            </Field>
            <Field label="LUT ARN" hint="For the export declaration on E/DIPL invoices">
              <input className={inputCls} value={f.lutArn} disabled={ro} onChange={set("lutArn")} />
            </Field>
          </>
        )}
        <Field label="Signed-for line" hint='"For … Limited", above the signature'>
          <input className={inputCls} value={f.signFor} disabled={ro} onChange={set("signFor")} />
        </Field>
        <Field label="Signatory name">
          <input className={inputCls} value={f.signatoryName} disabled={ro} onChange={set("signatoryName")} />
        </Field>
        <Field label="Thank-you line">
          <input className={inputCls} value={f.thanksLine} disabled={ro} onChange={set("thanksLine")} />
        </Field>
        <Field label="Small print under the line" hint="e.g. which fees are extra, and that payment is non-refundable" className="sm:col-span-2">
          <textarea className={`${inputCls} h-16 py-2`} value={f.note} disabled={ro} onChange={set("note")} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-md">
        <span className="text-label-sm font-semibold text-on-surface-variant">Signature</span>
        {e?.hasSignature || sigVersion > 0 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/finance/invoices/settings/signature/${code}?v=${sigVersion}`} alt="Signature" className="h-12 border border-outline-variant rounded bg-white" />
        ) : (
          <span className="text-caption text-on-surface-variant">None yet</span>
        )}
        {!ro && (
          <label className={`${btnCls} cursor-pointer`}>
            <Icon name="upload" />
            Upload PNG or JPG
            <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(ev) => upload(ev.target.files?.[0] ?? null)} />
          </label>
        )}
      </div>
      {s.error ? <Callout tone="bad" icon="error">{s.error}</Callout> : null}
      {!ro && (
        <div>
          <button
            className={primaryBtnCls}
            disabled={s.busy}
            onClick={() =>
              s.save(
                { action: "entity", code, ...f, gstin: india ? f.gstin || null : undefined, sacCode: india ? f.sacCode : undefined, lutArn: india ? f.lutArn || null : undefined },
                `${ENTITY_LABEL[code]} saved.`,
              )
            }
          >
            Save company
          </button>
        </div>
      )}
    </Card>
  );
}

function BanksCard({ data, done, ro }: { data: InvoicesPageData; done: (m: string) => void; ro: boolean }) {
  return (
    <Card title="Banks" sub="Which company invoices each bank's payments, and the bank details printed under &quot;Bank Account&quot;.">
      {data.settings.banks.map((b) => (
        <BankRow key={b.paymentMode} bank={b} done={done} ro={ro} />
      ))}
    </Card>
  );
}

function BankRow({ bank, done, ro }: { bank: InvoicesPageData["settings"]["banks"][number]; done: (m: string) => void; ro: boolean }) {
  const [details, setDetails] = useState(bank.details);
  const [isActive, setIsActive] = useState(bank.isActive);
  const [entityCode, setEntityCode] = useState(bank.entityCode);
  const s = useSave(done);
  return (
    <div className="grid gap-sm sm:grid-cols-[160px_1fr] border-t border-outline-variant pt-sm first:border-0 first:pt-0">
      <div className="flex flex-col gap-1">
        <b>{bank.paymentMode}</b>
        <label className="inline-flex items-center gap-2 text-body-md">
          <input type="checkbox" checked={isActive} disabled={ro} onChange={(e) => setIsActive(e.target.checked)} />
          Invoice its payments
        </label>
        <select className={inputCls} value={entityCode} disabled={ro} onChange={(e) => setEntityCode(e.target.value)}>
          {INVOICE_ENTITIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <textarea
          className={`${inputCls} h-24 py-2`}
          value={details}
          disabled={ro}
          placeholder={"Account name\nAccount No : …\nIFSC Code : …\nBranch"}
          onChange={(e) => setDetails(e.target.value)}
        />
        {s.error ? <Callout tone="bad" icon="error">{s.error}</Callout> : null}
        {!ro && (
          <div>
            <button className={btnCls} disabled={s.busy} onClick={() => s.save({ action: "bank", paymentMode: bank.paymentMode, details, isActive, entityCode }, `${bank.paymentMode} saved.`)}>
              Save {bank.paymentMode}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SeriesCard({ data, done, ro }: { data: InvoicesPageData; done: (m: string) => void; ro: boolean }) {
  return (
    <Card
      title="Number series"
      sub="Numbers are given on issue, one after another within each financial year, and never reused. Set the next number at cut-over to continue the series you raise today."
    >
      {data.settings.series.map((s) => (
        <SeriesRow key={s.key} series={s} upcoming={data.upcoming[s.key]} done={done} ro={ro} />
      ))}
    </Card>
  );
}

function SeriesRow({
  series,
  upcoming,
  done,
  ro,
}: {
  series: InvoicesPageData["settings"]["series"][number];
  upcoming: string | undefined;
  done: (m: string) => void;
  ro: boolean;
}) {
  const [prefix, setPrefix] = useState(series.prefix);
  const [fyStyle, setFyStyle] = useState<string>(series.fyStyle);
  const [padding, setPadding] = useState(series.padding);
  const [nextNumber, setNextNumber] = useState(series.nextNumber ?? "");
  const s = useSave(done);
  const long = (upcoming ?? "").length > GST_INVOICE_NO_MAX;
  return (
    <div className="flex flex-col gap-sm border-t border-outline-variant pt-sm first:border-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-md">
        <b>{SERIES_LABEL[series.key as SeriesKey] ?? series.key}</b>
        <span className="text-caption text-on-surface-variant">
          Next: <span className="tabular-nums font-semibold text-on-surface">{upcoming ?? "—"}</span> ({(upcoming ?? "").length} characters)
        </span>
      </div>
      <div className="grid gap-sm grid-cols-2 sm:grid-cols-4">
        <Field label="Prefix">
          <input className={inputCls} value={prefix} disabled={ro} onChange={(e) => setPrefix(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Year written as">
          <select className={inputCls} value={fyStyle} disabled={ro} onChange={(e) => setFyStyle(e.target.value)}>
            <option value="dash">26-27</option>
            <option value="compact">2627</option>
          </select>
        </Field>
        <Field label="Digits">
          <input type="number" min={1} max={6} className={inputCls} value={padding} disabled={ro} onChange={(e) => setPadding(Number(e.target.value))} />
        </Field>
        <Field label="Next number (optional)">
          <input className={inputCls} value={nextNumber} disabled={ro} placeholder={upcoming} onChange={(e) => setNextNumber(e.target.value.toUpperCase())} />
        </Field>
      </div>
      {long ? (
        <Callout tone="gold" icon="warning">
          {upcoming} is {(upcoming ?? "").length} characters; GST rules allow {GST_INVOICE_NO_MAX}. Confirm the format with your CA (writing the year
          as 2627 saves one).
        </Callout>
      ) : null}
      {series.key === "DLLC-DOM" ? (
        <p className="text-caption text-on-surface-variant">Shared with Partner Commissions: keep the prefix the same as in its settings. Numbers either one uses are skipped by the other.</p>
      ) : null}
      {s.error ? <Callout tone="bad" icon="error">{s.error}</Callout> : null}
      {!ro && (
        <div>
          <button
            className={btnCls}
            disabled={s.busy}
            onClick={() => s.save({ action: "series", key: series.key, prefix, fyStyle, padding, nextNumber: nextNumber || null }, "Series saved.")}
          >
            Save series
          </button>
        </div>
      )}
    </div>
  );
}
