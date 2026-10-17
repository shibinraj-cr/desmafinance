"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/esign/StatusBadge";
import { STATUS_LABELS } from "@/lib/esign/requests";
import { Icon, api, formatDate, inputCls, primaryBtn } from "./_ui";

export type AgreementRow = {
  id: string;
  reference: string;
  status: string;
  category: string | null;
  client: string | null;
  sentAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  createdBy: string | null;
};

export function AgreementsList({
  rows,
  sendingEnabled,
  isAdmin,
  waitingForMe,
}: {
  rows: AgreementRow[];
  sendingEnabled: boolean;
  isAdmin: boolean;
  waitingForMe: Array<{ id: string; reference: string; expiresAt: string | null }>;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!status || r.status === status) &&
        (!needle || r.reference.toLowerCase().includes(needle) || (r.client ?? "").toLowerCase().includes(needle)),
    );
  }, [rows, q, status]);

  return (
    <div className="space-y-md">
      {waitingForMe.length > 0 && (
        <div className="rounded-lg border border-sky-300 bg-sky-50 p-md space-y-xs">
          <div className="font-semibold flex items-center gap-xs">
            <Icon name="draw" /> Waiting for your signature ({waitingForMe.length})
          </div>
          <ul className="text-body-md space-y-xs">
            {waitingForMe.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-sm">
                <Link href={`/operations/agreements/${w.id}/sign`} className="font-semibold hover:underline">
                  {w.reference}
                </Link>
                {w.expiresAt && <span className="text-caption text-on-surface-variant">by {formatDate(w.expiresAt)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <SendingSwitch enabled={sendingEnabled} isAdmin={isAdmin} />

      <div className="flex flex-wrap items-center gap-sm">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <span className="absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant">
            <Icon name="search" />
          </span>
          <input className={inputCls + " pl-xl"} placeholder="Search client or agreement" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search agreements" />
        </div>
        <select className={inputCls.replace("w-full", "w-auto")} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <Link href="/operations/agreements/new" className={primaryBtn}>
          <Icon name="add" /> New agreement
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant p-xl text-center space-y-sm">
          <Icon name="contract" size={40} className="text-on-surface-variant" />
          <h3 className="text-h3 font-bold">No agreements yet</h3>
          <p className="text-body-md text-on-surface-variant max-w-lg mx-auto">
            Start one here or from a lead&apos;s page: pick a template, check the client&apos;s details, and send it for signature.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <p className="text-body-md text-on-surface-variant py-lg text-center">No agreements match these filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-body-md">
            <thead className="bg-surface-container-low text-left text-on-surface-variant">
              <tr>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Agreement</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Status</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Sent</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Expires</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">By</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-outline-variant align-top">
                  <td className="px-md py-sm">
                    <Link href={`/operations/agreements/${r.id}`} className="font-semibold hover:underline">
                      {r.reference}
                    </Link>
                    {r.category && <div className="text-caption text-on-surface-variant">{r.category}</div>}
                  </td>
                  <td className="px-md py-sm">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-md py-sm whitespace-nowrap">{r.sentAt ? formatDate(r.sentAt) : "—"}</td>
                  <td className="px-md py-sm whitespace-nowrap">{r.expiresAt && r.status !== "draft" ? formatDate(r.expiresAt) : "—"}</td>
                  <td className="px-md py-sm whitespace-nowrap">{r.createdBy ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SendingSwitch({ enabled, isAdmin }: { enabled: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (enabled && !isAdmin) return null;

  async function toggle() {
    if (
      !enabled &&
      !window.confirm(
        "Turn on sending to clients?\n\nClients will receive a link to sign. Only do this once the signing page is live — until then the link will not open.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/api/esign/settings/sending", "PUT", { enabled: !enabled });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the setting.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={"rounded-lg border p-md flex flex-wrap items-center gap-sm " + (enabled ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}>
      <Icon name={enabled ? "send" : "pause_circle"} />
      <div className="flex-1 min-w-[240px] text-body-md">
        {enabled ? (
          <>
            <b>Sending to clients is on.</b> Sent agreements reach clients by email and WhatsApp.
          </>
        ) : (
          <>
            <b>Sending to clients is off.</b> You can prepare agreements and save drafts; sending switches on once the signing page is live.
          </>
        )}
        {error && <div className="text-error mt-xs">{error}</div>}
      </div>
      {isAdmin && (
        <button type="button" onClick={toggle} disabled={busy} className="px-md py-xs rounded-md border border-outline-variant bg-surface-container-lowest font-semibold hover:bg-surface-container disabled:opacity-50">
          {enabled ? "Turn off" : "Turn on"}
        </button>
      )}
    </div>
  );
}
