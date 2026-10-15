"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { BuilderPage, type BuilderField } from "@/components/esign/BuilderPage";
import { fetchPdfBytes, openPdf } from "@/components/esign/pdf-client";
import { MERGE_KEYS } from "@/lib/esign/merge-keys";
import { deriveMergeValues, resolveMergeValues } from "@/lib/esign/merge-values";
import { MAX_EXPIRY_DAYS, mergeKeysOf, rolesOf, sendProblems, type SendInput } from "@/lib/esign/requests";
import type { StampItem } from "@/lib/esign/stamp";
import type { TemplateField } from "@/lib/esign/template-fields";
import type { PageGeometry } from "@/lib/esign/templates";
import { Field, Icon, Modal, api, inputCls, primaryBtn, secondaryBtn, taCls } from "../_ui";

export type TemplateOption = {
  id: string;
  name: string;
  category: string;
  versionId: string;
  version: number;
  numPages: number;
  fileSize: number;
  pages: PageGeometry[];
  fields: TemplateField[];
  defaultExpiryDays: number;
  defaultReminderDays: number;
  hasEmailText: boolean;
  whatsappTemplateName: string | null;
};

export type LeadInfo = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  dob: string | null;
  expectedValue: number | null;
  serviceName: string | null;
};

export type StaffOption = { id: string; name: string; email: string };

type SignerForm = { role: "Client" | "DESMA"; name: string; email: string; phone: string; signOrder: number };

export type DraftInfo = {
  id: string;
  templateId: string | null;
  mergeData: Record<string, string>;
  signers: Array<{ role: "Client" | "DESMA"; name: string; email: string | null; phone: string | null; signOrder: number }>;
  cc: Array<{ name: string; email: string }>;
  reminderDays: number;
  message: string | null;
};

type Delivery = { signerId: string; name: string; role: string; results: Array<{ channel: string; ok: boolean; to: string | null; detail?: string }> };

const ORIGIN_LABEL: Record<string, string> = { lead: "From the CRM", derived: "Calculated", manual: "Type this" };

function SectionTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-sm text-h3 font-bold">
      <span className="grid place-items-center w-7 h-7 rounded-full bg-primary text-on-primary text-body-md">{n}</span>
      {children}
    </h3>
  );
}

const section = "rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md";

export function NewAgreementWizard(props: {
  templates: TemplateOption[];
  lead: LeadInfo | null;
  draft: DraftInfo | null;
  staff: StaffOption[];
  staffName: string;
  sendingEnabled: boolean;
  nowIso: string;
}) {
  const router = useRouter();
  const [lead, setLead] = useState<LeadInfo | null>(props.lead);
  const [templateId, setTemplateId] = useState<string>(
    props.draft?.templateId && props.templates.some((t) => t.id === props.draft!.templateId)
      ? props.draft.templateId
      : props.templates.length === 1
        ? props.templates[0].id
        : "",
  );
  const template = props.templates.find((t) => t.id === templateId) ?? null;
  const keys = useMemo(() => (template ? mergeKeysOf(template.fields) : []), [template]);
  const roles = useMemo(() => (template ? rolesOf(template.fields) : new Set<string>()), [template]);

  const [values, setValues] = useState<Record<string, string>>({});
  const [overridden, setOverridden] = useState<Set<string>>(new Set());
  const [clientSigner, setClientSigner] = useState<SignerForm>(() => {
    const d = props.draft?.signers.find((s) => s.role === "Client");
    return {
      role: "Client",
      name: d?.name ?? props.lead?.name ?? "",
      email: d?.email ?? props.lead?.email ?? "",
      phone: d?.phone ?? props.lead?.phone ?? "",
      signOrder: d?.signOrder ?? 1,
    };
  });
  const [desmaSigner, setDesmaSigner] = useState<SignerForm>(() => {
    const d = props.draft?.signers.find((s) => s.role === "DESMA");
    return { role: "DESMA", name: d?.name ?? "", email: d?.email ?? "", phone: d?.phone ?? "", signOrder: d?.signOrder ?? 2 };
  });
  const [desmaFirst, setDesmaFirst] = useState(() => {
    const d = props.draft?.signers;
    const c = d?.find((s) => s.role === "Client");
    const m = d?.find((s) => s.role === "DESMA");
    return !!(c && m && m.signOrder < c.signOrder);
  });
  const [cc, setCc] = useState<Array<{ name: string; email: string }>>(props.draft?.cc ?? []);
  const [expiresInDays, setExpiresInDays] = useState(String(template?.defaultExpiryDays ?? 14));
  const [reminderDays, setReminderDays] = useState(String(props.draft?.reminderDays ?? template?.defaultReminderDays ?? 3));
  const [message, setMessage] = useState(props.draft?.message ?? "");
  const [busy, setBusy] = useState<"draft" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState<{ requestId: string; delivery: Delivery[] } | null>(null);

  // (Re)fill merge values whenever the client or template changes. Values staff
  // typed for "manual" keys survive; a draft's saved values win on first load.
  const draftApplied = useRef(false);
  useEffect(() => {
    if (!template) return;
    const now = new Date(props.nowIso);
    const resolved = lead
      ? resolveMergeValues(keys, {
          lead: {
            candidateName: lead.name,
            email: lead.email,
            phone: lead.phone,
            dob: lead.dob ? new Date(`${lead.dob}T00:00:00Z`) : null,
            serviceName: lead.serviceName,
            expectedValue: lead.expectedValue,
          },
          staffName: props.staffName,
          now,
        })
      : {};
    setValues((prev) => {
      const next: Record<string, string> = {};
      for (const k of keys) {
        const origin = MERGE_KEYS.find((m) => m.key === k)?.from.kind;
        next[k] = origin === "manual" && prev[k] ? prev[k] : resolved[k]?.value ?? "";
      }
      if (props.draft && !draftApplied.current) {
        draftApplied.current = true;
        for (const k of keys) if (props.draft.mergeData[k] !== undefined) next[k] = props.draft.mergeData[k];
        const derivedKeys = keys.filter((k) => MERGE_KEYS.find((m) => m.key === k)?.from.kind === "derived");
        setOverridden(new Set(derivedKeys.filter((k) => props.draft!.mergeData[k] !== undefined)));
        return next;
      }
      setOverridden(new Set());
      return next;
    });
  }, [template, keys, lead, props.nowIso, props.staffName, props.draft]);

  useEffect(() => {
    if (template && !props.draft) {
      setExpiresInDays(String(template.defaultExpiryDays));
      setReminderDays(String(template.defaultReminderDays));
    }
  }, [template, props.draft]);

  function pickLead(l: LeadInfo) {
    setLead(l);
    setClientSigner((s) => ({ ...s, name: l.name, email: l.email ?? "", phone: l.phone ?? "" }));
  }

  function setValue(key: string, v: string) {
    const isDerived = MERGE_KEYS.find((m) => m.key === key)?.from.kind === "derived";
    const nextOverridden = new Set(overridden);
    if (isDerived) nextOverridden.add(key);
    setOverridden(nextOverridden);
    setValues((prev) => deriveMergeValues({ ...prev, [key]: v }, nextOverridden));
  }

  function resetDerived(key: string) {
    const next = new Set(overridden);
    next.delete(key);
    setOverridden(next);
    setValues((prev) => deriveMergeValues(prev, next));
  }

  const needsDesma = roles.has("DESMA");
  const signers: SendInput["signers"] = [
    ...(roles.has("Client") || !template
      ? [{ ...clientSigner, email: clientSigner.email || null, phone: clientSigner.phone || null, signOrder: needsDesma && desmaFirst ? 2 : 1 }]
      : []),
    // A DESMA signer counts once someone is picked; until then the checks say "add a DESMA signer".
    ...(needsDesma && (desmaSigner.name.trim() || desmaSigner.email.trim())
      ? [{ ...desmaSigner, email: desmaSigner.email || null, phone: desmaSigner.phone || null, signOrder: desmaFirst ? 1 : 2 }]
      : []),
  ];

  const payload = (action: "draft" | "send"): SendInput | null =>
    lead && template
      ? {
          leadId: lead.id,
          templateVersionId: template.versionId,
          mergeData: values,
          signers,
          cc: cc.filter((c) => c.email.trim()),
          expiresInDays: Number(expiresInDays) || 14,
          reminderDays: Number(reminderDays) || 0,
          message: message.trim() || null,
          action,
          draftId: props.draft?.id ?? null,
        }
      : null;

  const problems = useMemo(() => {
    if (!lead) return ["Choose the client."];
    if (!template) return ["Choose a template."];
    const p = sendProblems({ input: { signers, mergeData: values, action: "send" }, fields: template.fields });
    const exp = Number(expiresInDays);
    if (!Number.isInteger(exp) || exp < 1 || exp > MAX_EXPIRY_DAYS) p.push(`The link must last 1–${MAX_EXPIRY_DAYS} days.`);
    return p;
    // signers is rebuilt each render from these inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead, template, values, clientSigner, desmaSigner, desmaFirst, expiresInDays]);

  async function submit(action: "draft" | "send") {
    const body = payload(action);
    if (!body) return;
    setBusy(action);
    setError(null);
    try {
      const res = await api<{ requestId: string; status: string; delivery: Delivery[] }>("/api/esign/requests", "POST", body);
      if (action === "draft") router.push(`/operations/agreements/${res.requestId}`);
      else setSent({ requestId: res.requestId, delivery: res.delivery });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  }

  if (sent) return <SentView sent={sent} />;

  const channels = [
    clientSigner.email ? `email to ${clientSigner.email}` : null,
    template?.whatsappTemplateName && lead?.phone ? `WhatsApp (template “${template.whatsappTemplateName}”) to ${lead.phone}` : null,
  ].filter(Boolean);

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-lg p-md md:p-margin">
      <div className="space-y-lg min-w-0">
        {/* 1. Client */}
        <section className={section}>
          <SectionTitle n={1}>Client</SectionTitle>
          {lead ? (
            <div className="flex flex-wrap items-start gap-sm">
              <div className="flex-1 min-w-0">
                <div className="font-semibold">{lead.name}</div>
                <div className="text-body-md text-on-surface-variant break-words">
                  {[lead.serviceName, lead.email, lead.phone].filter(Boolean).join(" · ") || "No contact details on the lead"}
                </div>
              </div>
              {!props.draft && (
                <button type="button" className={secondaryBtn} onClick={() => setLead(null)}>
                  Change
                </button>
              )}
            </div>
          ) : (
            <LeadPicker onPick={pickLead} />
          )}
        </section>

        {/* 2. Template */}
        <section className={section}>
          <SectionTitle n={2}>Template</SectionTitle>
          {props.templates.length === 0 ? (
            <p className="text-body-md text-on-surface-variant">
              There are no agreement templates yet. An admin can add one under Operations → Setup → Agreement Templates.
            </p>
          ) : (
            <select className={inputCls} value={templateId} onChange={(e) => setTemplateId(e.target.value)} aria-label="Template">
              <option value="">Choose a template…</option>
              {props.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name === t.category ? t.name : `${t.name} — ${t.category}`}
                </option>
              ))}
            </select>
          )}
          {template && template.fields.length === 0 && (
            <p className="text-body-md text-error">This template has no fields yet. Ask an admin to place them before sending.</p>
          )}
        </section>

        {/* 3. Details */}
        {template && keys.length > 0 && (
          <section className={section}>
            <SectionTitle n={3}>Details printed on the agreement</SectionTitle>
            <p className="text-body-md text-on-surface-variant">Check these before sending — the client cannot change them.</p>
            <div className="grid gap-md md:grid-cols-2">
              {keys.map((k) => {
                const def = MERGE_KEYS.find((m) => m.key === k);
                const origin = def?.from.kind ?? "manual";
                const multiline = template.fields.some((f) => f.mergeKey === k && f.type === "textarea");
                const empty = !(values[k] ?? "").trim();
                return (
                  <div key={k} className={multiline ? "md:col-span-2" : ""}>
                    <label className="block">
                      <span className="flex items-center gap-xs text-label-sm text-on-surface-variant mb-xs">
                        {def?.label ?? k}
                        <span className={"text-caption px-xs rounded " + (origin === "manual" ? "bg-amber-100 text-amber-900" : "bg-surface-container")}>
                          {ORIGIN_LABEL[origin]}
                        </span>
                      </span>
                      {multiline ? (
                        <textarea className={taCls + (empty ? " border-amber-400" : "")} rows={3} value={values[k] ?? ""} onChange={(e) => setValue(k, e.target.value)} />
                      ) : (
                        <input className={inputCls + (empty ? " border-amber-400" : "")} value={values[k] ?? ""} onChange={(e) => setValue(k, e.target.value)} />
                      )}
                    </label>
                    {origin === "derived" && overridden.has(k) && (
                      <button type="button" className="text-caption text-on-surface-variant hover:underline mt-xs" onClick={() => resetDerived(k)}>
                        Calculate again
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 4. Signers */}
        {template && (
          <section className={section}>
            <SectionTitle n={keys.length ? 4 : 3}>Who signs</SectionTitle>
            {roles.has("Client") && <SignerFields title="Client" signer={clientSigner} onChange={setClientSigner} />}
            {needsDesma && (
              <>
                <div className="border-t border-outline-variant pt-md space-y-sm">
                  <label className="block">
                    <span className="block text-label-sm text-on-surface-variant mb-xs">DESMA signs as</span>
                    <select
                      className={inputCls}
                      value={props.staff.find((s) => s.email === desmaSigner.email)?.id ?? ""}
                      onChange={(e) => {
                        const s = props.staff.find((x) => x.id === e.target.value);
                        if (s) setDesmaSigner((d) => ({ ...d, name: s.name, email: s.email }));
                      }}
                    >
                      <option value="">Choose a staff member…</option>
                      {props.staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.email})
                        </option>
                      ))}
                    </select>
                  </label>
                  <SignerFields title="DESMA" signer={desmaSigner} onChange={setDesmaSigner} hidePhone />
                </div>
                <fieldset className="space-y-xs">
                  <legend className="text-label-sm text-on-surface-variant mb-xs">Order</legend>
                  <label className="flex items-center gap-sm text-body-md">
                    <input type="radio" checked={!desmaFirst} onChange={() => setDesmaFirst(false)} /> Client signs first, then DESMA
                  </label>
                  <label className="flex items-center gap-sm text-body-md">
                    <input type="radio" checked={desmaFirst} onChange={() => setDesmaFirst(true)} /> DESMA signs first, then the client
                  </label>
                </fieldset>
              </>
            )}
            <div className="border-t border-outline-variant pt-md space-y-sm">
              <span className="block text-label-sm text-on-surface-variant">Also email the signed copy to (optional)</span>
              {cc.map((c, i) => (
                <div key={i} className="flex gap-xs">
                  <input className={inputCls} placeholder="Name" value={c.name} onChange={(e) => setCc(cc.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <input className={inputCls} placeholder="email@example.com" type="email" value={c.email} onChange={(e) => setCc(cc.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
                  <button type="button" className={secondaryBtn} onClick={() => setCc(cc.filter((_, j) => j !== i))} aria-label="Remove">
                    <Icon name="close" />
                  </button>
                </div>
              ))}
              {cc.length < 10 && (
                <button type="button" className="text-body-md font-semibold hover:underline inline-flex items-center gap-xs" onClick={() => setCc([...cc, { name: "", email: "" }])}>
                  <Icon name="add" /> Add someone
                </button>
              )}
            </div>
          </section>
        )}

        {/* 5. Sending */}
        {template && (
          <section className={section}>
            <SectionTitle n={keys.length ? 5 : 4}>Sending</SectionTitle>
            <div className="grid gap-md md:grid-cols-2">
              <Field label="Link works for (days)">
                <input className={inputCls} type="number" min={1} max={MAX_EXPIRY_DAYS} value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} />
              </Field>
              <Field label="Remind every (days)" hint="0 for no reminders.">
                <input className={inputCls} type="number" min={0} max={30} value={reminderDays} onChange={(e) => setReminderDays(e.target.value)} />
              </Field>
            </div>
            <Field label="Personal note (optional)" hint="Shown at the top of the email.">
              <textarea className={taCls} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
            </Field>
            <p className="text-body-md text-on-surface-variant">
              {channels.length ? <>The client gets the link by {channels.join(" and ")}.</> : "The client has no email or phone here, so the link cannot be sent."}
              {!template.whatsappTemplateName && " This template has no WhatsApp template set, so it goes by email only."}
            </p>
          </section>
        )}

        {/* Actions */}
        <div className="space-y-sm">
          {!props.sendingEnabled && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-md text-body-md">
              Sending to clients is switched off until the signing page is live. You can save this as a draft now and send it later.
            </div>
          )}
          {template && lead && problems.length > 0 && (
            <ul className="text-body-md text-on-surface-variant space-y-xs">
              {problems.map((p, i) => (
                <li key={i} className="flex gap-xs">
                  <Icon name="info" /> {p}
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p className="text-body-md text-error" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-sm">
            <button type="button" className={secondaryBtn} onClick={() => submit("draft")} disabled={!lead || !template || busy !== null}>
              {busy === "draft" ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              className={primaryBtn}
              onClick={() => setConfirming(true)}
              disabled={!props.sendingEnabled || problems.length > 0 || busy !== null}
            >
              <Icon name="send" /> Send for signature
            </button>
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="min-w-0">
        <div className="lg:sticky lg:top-20">
          <Preview template={template} values={values} />
        </div>
      </div>

      {confirming && template && lead && (
        <Modal title="Send for signature?" subtitle={`${template.name} to ${clientSigner.name}`} onClose={() => (busy ? null : setConfirming(false))}>
          <ul className="text-body-md space-y-xs list-disc pl-lg">
            {signers
              .slice()
              .sort((a, b) => a.signOrder - b.signOrder)
              .map((s) => (
                <li key={s.role}>
                  <b>{s.name}</b> ({s.role}) {s.signOrder === Math.min(...signers.map((x) => x.signOrder)) ? "gets the link now" : "gets it after the first signer"}
                  {s.email ? ` — ${s.email}` : ""}
                </li>
              ))}
          </ul>
          <p className="text-body-md text-on-surface-variant">The PDF is fixed once sent. To change it afterwards you cancel and send a new one.</p>
          <div className="flex justify-end gap-sm">
            <button type="button" className={secondaryBtn} onClick={() => setConfirming(false)} disabled={busy !== null}>
              Back
            </button>
            <button type="button" className={primaryBtn} onClick={() => submit("send")} disabled={busy !== null}>
              {busy === "send" ? "Sending…" : "Send"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SignerFields({ title, signer, onChange, hidePhone }: { title: string; signer: SignerForm; onChange: (s: SignerForm) => void; hidePhone?: boolean }) {
  return (
    <div className="grid gap-sm md:grid-cols-3">
      <Field label={`${title} name`}>
        <input className={inputCls} value={signer.name} onChange={(e) => onChange({ ...signer, name: e.target.value })} />
      </Field>
      <Field label="Email">
        <input className={inputCls} type="email" value={signer.email} onChange={(e) => onChange({ ...signer, email: e.target.value })} />
      </Field>
      {!hidePhone && (
        <Field label="Phone" hint="WhatsApp goes to the lead's own number.">
          <input className={inputCls} value={signer.phone} onChange={(e) => onChange({ ...signer, phone: e.target.value })} />
        </Field>
      )}
    </div>
  );
}

function LeadPicker({ onPick }: { onPick: (l: LeadInfo) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<LeadInfo[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/esign/leads?q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal });
        const data = (await res.json()) as { leads?: LeadInfo[] };
        setResults(data.leads ?? []);
      } catch {
        /* aborted or offline — keep the last results */
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);
  return (
    <div className="space-y-sm">
      <input className={inputCls} placeholder="Search by name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search for the client" />
      {loading && <p className="text-caption text-on-surface-variant">Searching…</p>}
      {results.length > 0 && (
        <ul className="rounded-lg border border-outline-variant divide-y divide-outline-variant max-h-72 overflow-y-auto">
          {results.map((l) => (
            <li key={l.id}>
              <button type="button" className="w-full text-left px-md py-sm hover:bg-surface-container" onClick={() => onPick(l)}>
                <div className="font-semibold">{l.name}</div>
                <div className="text-caption text-on-surface-variant">{[l.serviceName, l.email, l.phone].filter(Boolean).join(" · ")}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!loading && q.trim().length >= 2 && results.length === 0 && <p className="text-caption text-on-surface-variant">No leads match.</p>}
    </div>
  );
}

/**
 * The template with the current values stamped in — the same stamping code the
 * server runs when it sends — plus outlines where each signer will sign.
 */
function Preview({ template, values }: { template: TemplateOption | null; values: Record<string, string> }) {
  const [base, setBase] = useState<{ versionId: string; bytes: Uint8Array } | null>(null);
  const [font, setFont] = useState<Uint8Array | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(500);

  useEffect(() => {
    if (!box) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(box);
    return () => ro.disconnect();
  }, [box]);

  useEffect(() => {
    let cancelled = false;
    fetch("/fonts/esign/NotoSans-Regular.ttf")
      .then((r) => r.arrayBuffer())
      .then((b) => !cancelled && setFont(new Uint8Array(b)))
      .catch(() => !cancelled && setError("The preview font could not be loaded."));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!template) return;
    let cancelled = false;
    setError(null);
    fetchPdfBytes(`/api/esign/templates/${template.id}/versions/${template.versionId}/file`, template.fileSize)
      .then((bytes) => !cancelled && setBase({ versionId: template.versionId, bytes }))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "The template could not be loaded."));
    return () => {
      cancelled = true;
    };
  }, [template]);

  const stampItems = useMemo<StampItem[]>(
    () =>
      template
        ? template.fields
            .filter((f) => f.mergeKey)
            .map((f) => ({
              kind: "text" as const,
              page: f.page,
              x: f.x,
              y: f.y,
              w: f.w,
              h: f.h,
              text: values[f.mergeKey!] ?? "",
              fontSize: f.fontSize,
              alignment: f.alignment,
              multiline: f.type === "textarea",
            }))
        : [],
    [template, values],
  );

  const current = useRef<PDFDocumentProxy | null>(null);
  useEffect(() => {
    if (!template || !base || base.versionId !== template.versionId || !font) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { stampPdf } = await import("@/lib/esign/stamp");
        const stamped = await stampPdf(base.bytes, font, stampItems);
        const next = await openPdf(stamped);
        if (cancelled) return void next.destroy();
        const prev = current.current;
        current.current = next;
        setDoc(next);
        void prev?.destroy();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "The preview could not be drawn.");
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [template, base, font, stampItems]);

  const signerBoxes = useCallback(
    (page: number): BuilderField[] =>
      (template?.fields ?? []).filter((f) => !f.mergeKey && f.page === page).map((f, i) => ({ ...f, uid: `p${page}-${i}` })),
    [template],
  );

  if (!template) {
    return (
      <div className="rounded-xl border border-dashed border-outline-variant p-xl text-center text-body-md text-on-surface-variant">
        Choose a template to see the agreement here.
      </div>
    );
  }
  const maxW = Math.max(...template.pages.map((p) => p.w));
  const scale = Math.max(200, width - 24) / maxW;
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container">
      <div className="px-md py-sm border-b border-outline-variant text-body-md flex items-center gap-xs">
        <Icon name="visibility" /> Preview — {template.name} v{template.version}
        <span className="text-caption text-on-surface-variant ml-auto hidden md:inline">Outlined boxes are filled in when signing</span>
      </div>
      <div ref={setBox} className="p-sm overflow-y-auto max-h-[75vh] lg:max-h-[calc(100vh-10rem)]">
        {error ? (
          <p className="p-lg text-center text-body-md text-error">{error}</p>
        ) : (
          <div className="flex flex-col items-center gap-md">
            {template.pages.map((geom, i) => (
              <BuilderPage
                key={`${template.versionId}-${i}`}
                pageNo={i + 1}
                numPages={template.numPages}
                geom={geom}
                scale={scale}
                renderScale={scale}
                doc={doc}
                scroller={box}
                fields={signerBoxes(i + 1)}
                selected={null}
                readOnly
                onPointerDownField={() => {}}
                onSelect={() => {}}
                onDropField={() => {}}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SentView({ sent }: { sent: { requestId: string; delivery: Delivery[] } }) {
  const anyFailed = sent.delivery.some((d) => d.results.length === 0 || d.results.every((r) => !r.ok));
  return (
    <div className="p-md md:p-margin max-w-2xl space-y-lg">
      <div className={"rounded-xl border p-lg space-y-md " + (anyFailed ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50")}>
        <h3 className="text-h3 font-bold flex items-center gap-sm">
          <Icon name={anyFailed ? "warning" : "check_circle"} />
          {anyFailed ? "Sent, but a link did not get through" : "Agreement sent"}
        </h3>
        {sent.delivery.map((d) => (
          <div key={d.signerId} className="space-y-xs">
            <div className="font-semibold">
              {d.name} ({d.role})
            </div>
            {d.results.length === 0 && <div className="text-body-md">No email or WhatsApp could be used — fix the contact details and resend.</div>}
            <ul className="text-body-md space-y-xs">
              {d.results.map((r, i) => (
                <li key={i} className="flex gap-xs">
                  <Icon name={r.ok ? "done" : "close"} className={r.ok ? "text-emerald-700" : "text-error"} />
                  <span>
                    {r.channel === "email" ? "Email" : "WhatsApp"} {r.to ? `to ${r.to}` : ""}: {r.ok ? "sent" : r.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="flex gap-sm">
        <Link href={`/operations/agreements/${sent.requestId}`} className={primaryBtn}>
          Open the agreement
        </Link>
        <Link href="/operations/agreements" className={secondaryBtn}>
          All agreements
        </Link>
      </div>
    </div>
  );
}
