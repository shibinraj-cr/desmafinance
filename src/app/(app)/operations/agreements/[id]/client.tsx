"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/esign/StatusBadge";
import { MERGE_KEYS } from "@/lib/esign/merge-keys";
import { EVENT_LABELS, activeSigners, isOpenStatus } from "@/lib/esign/requests";
import { Field, Icon, Modal, api, formatDate, formatDateTime, inputCls, primaryBtn, secondaryBtn, taCls } from "../_ui";

type SignerDTO = {
  id: string;
  role: string;
  name: string;
  email: string | null;
  phone: string | null;
  signOrder: number;
  status: string;
  hasLink: boolean;
  viewedAt: string | null;
  signedAt: string | null;
  declineReason: string | null;
  inApp: boolean;
};
type EventDTO = { id: number; seq: number; action: string; actor: string | null; signerId: string | null; meta: Record<string, unknown>; createdAt: string };

export type AgreementDetailDTO = {
  id: string;
  reference: string;
  status: string;
  category: string | null;
  lead: { id: string; name: string } | null;
  template: { id: string; name: string; version: number } | null;
  hasPdf: boolean;
  hasCurrent: boolean;
  hasSigned: boolean;
  signedSha256: string | null;
  canSignNow: boolean;
  originalSha256: string | null;
  createdBy: string | null;
  createdAt: string;
  sentAt: string | null;
  expiresAt: string | null;
  reminderDays: number | null;
  cancelledReason: string | null;
  cc: Array<{ name: string; email: string }>;
  mergeData: Record<string, string>;
  signers: SignerDTO[];
  events: EventDTO[];
  chainIntact: boolean;
  sendingEnabled: boolean;
};


type ChannelResult = { channel: string; ok: boolean; to: string | null; detail?: string };

const SIGNER_STATUS: Record<string, string> = {
  waiting: "Waiting for their turn",
  sent: "Their turn — notified",
  viewed: "Opened",
  signed: "Signed",
  declined: "Declined",
  cancelled: "Cancelled",
};

export function AgreementDetail({ a }: { a: AgreementDetailDTO }) {
  const router = useRouter();
  const [modal, setModal] = useState<null | { kind: "cancel" } | { kind: "extend" } | { kind: "contact"; signer: SignerDTO }>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const open = isOpenStatus(a.status);
  const active = new Set(activeSigners(a.signers).map((s) => s.id));
  const waiting = ["sent", "viewed", "partially_signed"].includes(a.status);
  const expired = !!a.expiresAt && new Date(a.expiresAt) <= new Date();

  async function resend(s: SignerDTO) {
    if (!window.confirm(`Send ${s.name} a new link? The link they have now will stop working.`)) return;
    setBusy(`resend:${s.id}`);
    setNotice(null);
    try {
      const { delivery } = await api<{ delivery: { results: ChannelResult[] } }>(`/api/esign/requests/${a.id}/resend`, "POST", { signerId: s.id });
      const ok = delivery.results.filter((r) => r.ok).map((r) => (r.channel === "email" ? "email" : "WhatsApp"));
      const failed = delivery.results.filter((r) => !r.ok);
      setNotice({
        ok: ok.length > 0,
        text: ok.length
          ? `New link sent to ${s.name} by ${ok.join(" and ")}.${failed.length ? ` ${failed.map((f) => f.detail).join(" ")}` : ""}`
          : `The new link did not get through: ${failed.map((f) => f.detail).join(" ") || "no email or WhatsApp available."}`,
      });
      router.refresh();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : "Could not resend." });
    } finally {
      setBusy(null);
    }
  }

  const deliveries = a.events.filter((e) => e.action === "notified");

  return (
    <div className="space-y-lg max-w-5xl">
      <div className="flex flex-wrap items-center gap-sm">
        <StatusBadge status={a.status} />
        {waiting && expired && <span className="text-body-md text-error">Link expired {a.expiresAt && formatDate(a.expiresAt)}</span>}
        <div className="flex-1" />
        {a.status === "draft" && (
          <Link href={`/operations/agreements/new?draft=${a.id}`} className={primaryBtn}>
            <Icon name="edit" /> Continue
          </Link>
        )}
        {a.canSignNow && (
          <Link href={`/operations/agreements/${a.id}/sign`} className={primaryBtn}>
            <Icon name="draw" /> Sign now
          </Link>
        )}
        {a.hasSigned && (
          <a href={`/api/esign/requests/${a.id}/file?kind=signed`} target="_blank" rel="noreferrer" className={primaryBtn}>
            <Icon name="verified" /> Signed PDF
          </a>
        )}
        {a.hasCurrent && (
          <a href={`/api/esign/requests/${a.id}/file?kind=current`} target="_blank" rel="noreferrer" className={secondaryBtn}>
            <Icon name="picture_as_pdf" /> Current copy
          </a>
        )}
        {a.hasPdf && (
          <a href={`/api/esign/requests/${a.id}/file`} target="_blank" rel="noreferrer" className={secondaryBtn}>
            <Icon name="picture_as_pdf" /> PDF as sent
          </a>
        )}
        {(waiting || a.status === "expired") && (
          <button type="button" className={secondaryBtn} onClick={() => setModal({ kind: "extend" })}>
            <Icon name="event" /> Extend
          </button>
        )}
        {open && (
          <button type="button" className={secondaryBtn} onClick={() => setModal({ kind: "cancel" })}>
            <Icon name="block" /> {a.status === "draft" ? "Discard draft" : "Cancel"}
          </button>
        )}
      </div>

      {notice && (
        <p className={"text-body-md " + (notice.ok ? "text-emerald-800" : "text-error")} role="status">
          {notice.text}
        </p>
      )}
      {a.status === "cancelled" && a.cancelledReason && (
        <div className="rounded-lg border border-outline-variant bg-surface-container-low p-md text-body-md">Cancelled: {a.cancelledReason}</div>
      )}

      <section className="grid gap-md md:grid-cols-2">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-xs text-body-md">
          <Row label="Client">
            {a.lead ? (
              <Link href={`/crm/leads/${a.lead.id}`} className="hover:underline">
                {a.lead.name}
              </Link>
            ) : (
              "—"
            )}
          </Row>
          <Row label="Template">{a.template ? `${a.template.name} (v${a.template.version})` : "—"}</Row>
          <Row label="Created">
            {formatDateTime(a.createdAt)}
            {a.createdBy ? ` by ${a.createdBy}` : ""}
          </Row>
          <Row label="Sent">{a.sentAt ? formatDateTime(a.sentAt) : "Not yet"}</Row>
          <Row label="Link works until">{a.expiresAt && a.status !== "draft" ? formatDateTime(a.expiresAt) : "—"}</Row>
          <Row label="Reminders">{a.reminderDays ? `Every ${a.reminderDays} days` : "Off"}</Row>
          {a.cc.length > 0 && <Row label="Signed copy also to">{a.cc.map((c) => c.email).join(", ")}</Row>}
          {a.signedSha256 && (
            <Row label="Signed fingerprint">
              <span className="font-mono text-caption break-all" title="SHA-256 of the signed PDF; checkable on the public verify page">
                {a.signedSha256}
              </span>
            </Row>
          )}
          {a.originalSha256 && (
            <Row label="PDF fingerprint">
              <span className="font-mono text-caption break-all" title="SHA-256 of the PDF as sent">
                {a.originalSha256}
              </span>
            </Row>
          )}
        </div>
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-xs text-body-md">
          <div className="text-label-sm uppercase tracking-wider text-on-surface-variant mb-xs">Printed on the agreement</div>
          {Object.keys(a.mergeData).length === 0 && <div className="text-on-surface-variant">Nothing filled from the CRM.</div>}
          {Object.entries(a.mergeData).map(([k, v]) => (
            <Row key={k} label={MERGE_KEYS.find((m) => m.key === k)?.label ?? k}>
              <span className="whitespace-pre-wrap break-words">{v || "—"}</span>
            </Row>
          ))}
        </div>
      </section>

      <section className="space-y-sm">
        <h3 className="text-h3 font-bold">Signers</h3>
        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-body-md">
            <thead className="bg-surface-container-low text-left text-on-surface-variant">
              <tr>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Order</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Signer</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Contact</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Status</th>
                <th className="px-md py-sm" />
              </tr>
            </thead>
            <tbody>
              {a.signers.map((s) => (
                <tr key={s.id} className="border-t border-outline-variant align-top">
                  <td className="px-md py-sm tabular-nums">{s.signOrder}</td>
                  <td className="px-md py-sm">
                    <div className="font-semibold">{s.name}</div>
                    <div className="text-caption text-on-surface-variant">{s.role}</div>
                  </td>
                  <td className="px-md py-sm break-all">
                    {s.email && <div>{s.email}</div>}
                    {s.phone && <div>{s.phone}</div>}
                  </td>
                  <td className="px-md py-sm">
                    {SIGNER_STATUS[s.status] ?? s.status}
                    {s.signedAt && <div className="text-caption text-on-surface-variant">{formatDateTime(s.signedAt)}</div>}
                    {s.declineReason && <div className="text-caption text-error">“{s.declineReason}”</div>}
                    {s.inApp && s.status !== "signed" && <div className="text-caption text-on-surface-variant">Signs in DesGro</div>}
                  </td>
                  <td className="px-md py-sm">
                    <div className="flex justify-end gap-xs">
                      {waiting && !expired && active.has(s.id) && (
                        <button
                          type="button"
                          className={secondaryBtn + " !py-xs"}
                          onClick={() => resend(s)}
                          disabled={busy !== null || !a.sendingEnabled}
                          title={a.sendingEnabled ? "Send a new link" : "Sending to clients is switched off"}
                        >
                          <Icon name="forward_to_inbox" /> {busy === `resend:${s.id}` ? "Sending…" : "Resend"}
                        </button>
                      )}
                      {open && !["signed", "declined", "cancelled"].includes(s.status) && (
                        <button type="button" className={secondaryBtn + " !py-xs"} onClick={() => setModal({ kind: "contact", signer: s })} aria-label={`Edit ${s.name}'s contact details`}>
                          <Icon name="edit" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {deliveries.length > 0 && (
        <section className="space-y-sm">
          <h3 className="text-h3 font-bold">Delivery</h3>
          <ul className="space-y-sm">
            {deliveries
              .slice()
              .reverse()
              .map((e) => {
                const signer = a.signers.find((s) => s.id === e.signerId);
                const results = (e.meta.results as ChannelResult[] | undefined) ?? [];
                return (
                  <li key={e.id} className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md text-body-md">
                    <div className="text-caption text-on-surface-variant">
                      {formatDateTime(e.createdAt)} · {signer?.name ?? "Signer"}
                    </div>
                    {results.length === 0 && <div className="text-error">No email or WhatsApp was available.</div>}
                    {results.map((r, i) => (
                      <div key={i} className="flex gap-xs">
                        <Icon name={r.ok ? "done" : "close"} className={r.ok ? "text-emerald-700" : "text-error"} />
                        {r.channel === "email" ? "Email" : "WhatsApp"} {r.to ? `to ${r.to}` : ""}: {r.ok ? "sent" : r.detail}
                      </div>
                    ))}
                  </li>
                );
              })}
          </ul>
        </section>
      )}

      <section className="space-y-sm">
        <div className="flex items-center gap-sm">
          <h3 className="text-h3 font-bold">History</h3>
          <span className={"text-caption inline-flex items-center gap-xs " + (a.chainIntact ? "text-emerald-800" : "text-error")} title="Each entry is hash-chained to the one before; the database re-checks the whole chain.">
            <Icon name={a.chainIntact ? "verified" : "gpp_bad"} size={16} />
            {a.chainIntact ? "Audit trail verified" : "Audit trail check failed"}
          </span>
        </div>
        <ol className="rounded-xl border border-outline-variant bg-surface-container-lowest divide-y divide-outline-variant">
          {a.events.map((e) => (
            <li key={e.id} className="px-md py-sm text-body-md flex flex-wrap gap-x-md gap-y-xs">
              <span className="text-on-surface-variant whitespace-nowrap tabular-nums">{formatDateTime(e.createdAt)}</span>
              <span className="font-semibold">{EVENT_LABELS[e.action] ?? e.action}</span>
              <span className="text-on-surface-variant">{eventDetail(e, a.signers)}</span>
              {e.actor && <span className="text-caption text-on-surface-variant ml-auto">{e.actor}</span>}
            </li>
          ))}
        </ol>
      </section>

      {modal?.kind === "cancel" && <CancelModal id={a.id} draft={a.status === "draft"} onClose={() => setModal(null)} />}
      {modal?.kind === "extend" && <ExtendModal id={a.id} current={a.expiresAt} onClose={() => setModal(null)} />}
      {modal?.kind === "contact" && <ContactModal id={a.id} signer={modal.signer} onClose={() => setModal(null)} />}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-sm">
      <span className="text-on-surface-variant">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function eventDetail(e: EventDTO, signers: SignerDTO[]): string {
  const who = signers.find((s) => s.id === e.signerId)?.name;
  switch (e.action) {
    case "created":
      return e.meta.draft ? "as a draft" : "";
    case "sent":
      return `link sent to ${((e.meta.linksIssuedTo as string[] | undefined) ?? []).join(" and ") || "the first signer"}`;
    case "notified": {
      const results = (e.meta.results as ChannelResult[] | undefined) ?? [];
      return `${who ?? ""}: ${results.map((r) => `${r.channel} ${r.ok ? "✓" : "✗"}`).join(", ") || "nothing could be sent"}`;
    }
    case "resent":
      return who ? `to ${who}; the previous link stopped working` : "";
    case "contact_changed":
      return `${who ?? ""}: ${Object.keys((e.meta.changed as Record<string, unknown>) ?? {}).join(", ")}`;
    case "expiry_extended":
      return typeof e.meta.to === "string" ? `to ${formatDate(e.meta.to)}` : "";
    case "cancelled":
      return typeof e.meta.reason === "string" ? e.meta.reason : "";
    case "opened":
      return who ?? "";
    case "otp_sent":
      return `${who ?? ""}: by ${String(e.meta.channel ?? "")} to ${String(e.meta.to ?? "")}`;
    case "otp_verified":
      return who ?? "";
    case "otp_failed":
      return `${who ?? ""}${typeof e.meta.attemptsLeft === "number" ? ` — ${e.meta.attemptsLeft} tries left` : ""}`;
    case "field_saved":
      return `${who ?? ""}: ${((e.meta.fields as string[] | undefined) ?? []).length} boxes`;
    case "signed":
      return `${who ?? ""}${typeof e.meta.verifiedBy === "string" ? ` — ${e.meta.verifiedBy}` : ""}`;
    case "declined":
      return `${who ?? ""}${typeof e.meta.reason === "string" ? `: ${e.meta.reason}` : ""}`;
    default:
      return "";
  }
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, done: () => void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      done();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function CancelModal({ id, draft, onClose }: { id: string; draft: boolean; onClose: () => void }) {
  const [reason, setReason] = useState(draft ? "Draft discarded" : "");
  const { busy, error, run } = useAction();
  return (
    <Modal title={draft ? "Discard this draft?" : "Cancel this agreement?"} subtitle={draft ? undefined : "Any link already sent stops working straight away."} onClose={busy ? () => {} : onClose}>
      <Field label="Reason">
        <textarea className={taCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
      </Field>
      {error && <p className="text-body-md text-error">{error}</p>}
      <div className="flex justify-end gap-sm">
        <button type="button" className={secondaryBtn} onClick={onClose} disabled={busy}>
          Back
        </button>
        <button type="button" className={primaryBtn} disabled={busy || !reason.trim()} onClick={() => run(() => api(`/api/esign/requests/${id}/cancel`, "POST", { reason }), onClose)}>
          {draft ? "Discard" : "Cancel agreement"}
        </button>
      </div>
    </Modal>
  );
}

function ExtendModal({ id, current, onClose }: { id: string; current: string | null; onClose: () => void }) {
  const base = current && new Date(current) > new Date() ? new Date(current) : new Date();
  const suggested = new Date(base.getTime() + 7 * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const [until, setUntil] = useState(suggested);
  const { busy, error, run } = useAction();
  return (
    <Modal title="Extend the link" subtitle={current ? `Currently works until ${formatDateTime(current)}.` : undefined} onClose={busy ? () => {} : onClose}>
      <Field label="Works until (end of day, India time)">
        <input className={inputCls} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
      </Field>
      {error && <p className="text-body-md text-error">{error}</p>}
      <div className="flex justify-end gap-sm">
        <button type="button" className={secondaryBtn} onClick={onClose} disabled={busy}>
          Back
        </button>
        <button type="button" className={primaryBtn} disabled={busy || !until} onClick={() => run(() => api(`/api/esign/requests/${id}/extend`, "POST", { until }), onClose)}>
          Extend
        </button>
      </div>
    </Modal>
  );
}

function ContactModal({ id, signer, onClose }: { id: string; signer: SignerDTO; onClose: () => void }) {
  const [name, setName] = useState(signer.name);
  const [email, setEmail] = useState(signer.email ?? "");
  const [phone, setPhone] = useState(signer.phone ?? "");
  const { busy, error, run } = useAction();
  return (
    <Modal title={`Edit ${signer.name}`} subtitle="The change is logged. Resend afterwards so the new address gets a link." onClose={busy ? () => {} : onClose}>
      <Field label="Name">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Email">
        <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Phone">
        <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      {error && <p className="text-body-md text-error">{error}</p>}
      <div className="flex justify-end gap-sm">
        <button type="button" className={secondaryBtn} onClick={onClose} disabled={busy}>
          Back
        </button>
        <button
          type="button"
          className={primaryBtn}
          disabled={busy || !name.trim()}
          onClick={() => run(() => api(`/api/esign/requests/${id}/signers/${signer.id}`, "PATCH", { name, email: email || null, phone: phone || null }), onClose)}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
