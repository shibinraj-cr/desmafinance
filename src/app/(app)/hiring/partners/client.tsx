"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshBar } from "@/components/hiring/RefreshBar";

type PartnerRow = {
  id: string; agencyName: string; primaryContactName: string | null; contactEmail: string;
  focusAreas: string[]; feePercent: number | null; status: string; grantedJobIds: string[];
  submitted: number; inPipeline: number; placed: number; fillRate: number | null; avgDays: number | null;
};

const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md";
const primaryBtn =
  "h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition disabled:opacity-60";
const btn =
  "h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-60";

export function PartnersClient({
  partners,
  jobs,
  loadedAt,
}: {
  partners: PartnerRow[];
  jobs: { id: string; title: string }[];
  loadedAt: string;
}) {
  const router = useRouter();
  const [inviting, setInviting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [agencyName, setAgencyName] = useState("");
  const [primaryContactName, setPrimaryContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [feePercent, setFeePercent] = useState("8.33");
  const [focusAreas, setFocusAreas] = useState("");

  async function call(label: string, url: string, body?: unknown, method = "POST") {
    setBusy(label);
    setError(null);
    setNotice(null);
    const res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(null);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      setError(d.message ?? "That didn't work.");
      return false;
    }
    router.refresh();
    return true;
  }

  const totals = partners.reduce(
    (acc, p) => ({
      submissions: acc.submissions + p.submitted,
      placements: acc.placements + p.placed,
    }),
    { submissions: 0, placements: 0 },
  );
  const avgFill =
    partners.filter((p) => p.fillRate != null).length === 0
      ? null
      : Math.round(
          partners.filter((p) => p.fillRate != null).reduce((a, p) => a + (p.fillRate ?? 0), 0) /
            partners.filter((p) => p.fillRate != null).length,
        );

  return (
    <div className="space-y-lg">
      {error && (
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm text-body-md text-on-surface">
          {notice}
        </div>
      )}

      <div className="grid gap-md grid-cols-2 lg:grid-cols-4">
        <Kpi label="Partners" value={partners.length} />
        <Kpi label="Submissions" value={totals.submissions} />
        <Kpi label="Placements" value={totals.placements} />
        <Kpi label="Avg fill rate" value={avgFill == null ? "—" : `${avgFill}%`} />
      </div>

      <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
        <h2 className="text-h3 text-on-surface mb-sm">How this works</h2>
        <ol className="grid gap-md sm:grid-cols-3 text-body-md text-on-surface-variant">
          <li>
            <strong className="text-on-surface">1. Invite by email.</strong> They get a magic link —
            no password, no Desgro account.
          </li>
          <li>
            <strong className="text-on-surface">2. Scope by job.</strong> They see only the
            requisitions you grant, and only their own submissions.
          </li>
          <li>
            <strong className="text-on-surface">3. Pay on placement.</strong> The fee is snapshotted
            at submission and becomes payable when the offer is accepted.
          </li>
        </ol>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-md">
        <h2 className="text-h2 text-on-surface">Agencies</h2>
        <div className="flex items-center gap-xs">
          <RefreshBar loadedAt={loadedAt} />
          <button type="button" className={primaryBtn} onClick={() => setInviting((v) => !v)}>
            Invite recruiter
          </button>
        </div>
      </div>

      {inviting && (
        <section className="rounded-xl border border-outline-variant bg-surface-container-low p-lg space-y-md">
          <div className="grid gap-md sm:grid-cols-2">
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">Agency</span>
              <input className={inputCls} value={agencyName} onChange={(e) => setAgencyName(e.target.value)} />
            </label>
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">Contact name</span>
              <input className={inputCls} value={primaryContactName} onChange={(e) => setPrimaryContactName(e.target.value)} />
            </label>
          </div>
          <div className="grid gap-md sm:grid-cols-3">
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">Contact email</span>
              <input className={inputCls} type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </label>
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">Fee %</span>
              <input className={inputCls} type="number" min={0} max={100} step="0.01" value={feePercent} onChange={(e) => setFeePercent(e.target.value)} />
            </label>
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">Focus areas</span>
              <input className={inputCls} value={focusAreas} onChange={(e) => setFocusAreas(e.target.value)} placeholder="Sales, Operations" />
            </label>
          </div>
          <div className="flex gap-xs">
            <button
              type="button"
              className={primaryBtn}
              disabled={busy === "create" || agencyName.trim().length < 2 || !contactEmail.trim()}
              onClick={async () => {
                const ok = await call("create", "/api/hiring/partners", {
                  agencyName,
                  primaryContactName: primaryContactName || undefined,
                  contactEmail,
                  feePercent: Number(feePercent) || null,
                  focusAreas: focusAreas.split(",").map((s) => s.trim()).filter(Boolean),
                });
                if (ok) {
                  setInviting(false);
                  setNotice("Agency added. Grant them a requisition, then send the portal link.");
                  setAgencyName("");
                  setContactEmail("");
                }
              }}
            >
              {busy === "create" ? "Adding…" : "Add agency"}
            </button>
            <button type="button" className={btn} onClick={() => setInviting(false)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {partners.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-xl text-center">
          <div className="text-body-lg text-on-surface mb-xs">No sourcing partners yet</div>
          <p className="text-body-sm text-on-surface-variant max-w-prose mx-auto">
            An agency here sees only what you grant them — never the wider pipeline, never another
            agency&rsquo;s candidates, and never your internal notes.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-x-auto">
          <table className="w-full text-body-md">
            <thead className="text-left border-b border-outline-variant bg-surface-container-low">
              <tr className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                <th className="px-lg py-sm">Agency</th>
                <th className="px-md py-sm">Focus</th>
                <th className="px-md py-sm text-right">Submitted</th>
                <th className="px-md py-sm text-right">In pipeline</th>
                <th className="px-md py-sm text-right">Placed</th>
                <th className="px-md py-sm text-right">Fill rate</th>
                <th className="px-md py-sm text-right">Fee</th>
                <th className="px-md py-sm">Status</th>
                <th className="px-md py-sm sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <Fragment key={p.id}>
                  <tr className="border-b border-outline-variant">
                    <td className="px-lg py-sm">
                      <div className="text-on-surface font-medium">{p.agencyName}</div>
                      <div className="text-caption text-on-surface-variant">
                        {p.primaryContactName ? `${p.primaryContactName} · ` : ""}
                        {p.contactEmail}
                      </div>
                    </td>
                    <td className="px-md py-sm text-on-surface-variant">{p.focusAreas.join(", ") || "—"}</td>
                    <td className="px-md py-sm text-right tabular-nums">{p.submitted}</td>
                    <td className="px-md py-sm text-right tabular-nums">{p.inPipeline}</td>
                    <td className="px-md py-sm text-right tabular-nums">{p.placed}</td>
                    <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">
                      {p.fillRate == null ? "—" : `${p.fillRate}%`}
                    </td>
                    <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">
                      {p.feePercent == null ? "—" : `${p.feePercent}%`}
                    </td>
                    <td className="px-md py-sm">
                      <span className="inline-flex items-center h-6 px-sm rounded-full bg-surface-container text-label-sm text-on-surface-variant">
                        {p.status}
                      </span>
                    </td>
                    <td className="px-md py-sm">
                      <div className="flex items-center justify-end gap-xs">
                        <button
                          type="button"
                          className={btn}
                          aria-expanded={expanded === p.id}
                          onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                        >
                          {p.grantedJobIds.length} reqs
                        </button>
                        <button
                          type="button"
                          className={btn}
                          disabled={busy !== null}
                          onClick={async () => {
                            const ok = await call(`inv-${p.id}`, `/api/hiring/partners/${p.id}/invite`);
                            if (ok) setNotice(`Portal link emailed to ${p.contactEmail}.`);
                          }}
                        >
                          {busy === `inv-${p.id}` ? "Sending…" : "Send link"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === p.id && (
                    <tr className="border-b border-outline-variant bg-surface-container-low">
                      <td colSpan={9} className="px-lg py-md">
                        <JobAccess
                          jobs={jobs}
                          granted={p.grantedJobIds}
                          busy={busy === `jobs-${p.id}`}
                          onSave={(jobIds) => call(`jobs-${p.id}`, `/api/hiring/partners/${p.id}/jobs`, { jobIds }, "PUT")}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
      <div className="text-h1 tabular-nums text-on-surface">{value}</div>
      <div className="text-label-sm text-on-surface-variant uppercase tracking-wider">{label}</div>
    </div>
  );
}

function JobAccess({
  jobs,
  granted,
  busy,
  onSave,
}: {
  jobs: { id: string; title: string }[];
  granted: string[];
  busy: boolean;
  onSave: (jobIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(granted);
  const dirty = selected.slice().sort().join(",") !== granted.slice().sort().join(",");

  return (
    <div>
      <div className="text-label-sm text-on-surface-variant mb-sm">
        This list is the boundary. Removing a requisition hides it and every candidate they
        submitted to it, immediately.
      </div>
      {jobs.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">No open requisitions to grant.</p>
      ) : (
        <div className="grid gap-xs sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((j) => (
            <label
              key={j.id}
              className={
                "flex items-center gap-xs px-sm py-xs rounded-lg border cursor-pointer transition " +
                (selected.includes(j.id)
                  ? "border-primary bg-primary-fixed/30"
                  : "border-outline-variant bg-surface-container-lowest")
              }
            >
              <input
                type="checkbox"
                className="accent-primary"
                checked={selected.includes(j.id)}
                onChange={(e) =>
                  setSelected((prev) => (e.target.checked ? [...prev, j.id] : prev.filter((x) => x !== j.id)))
                }
              />
              <span className="text-body-sm text-on-surface">{j.title}</span>
            </label>
          ))}
        </div>
      )}
      {dirty && (
        <button type="button" className={primaryBtn + " mt-sm"} disabled={busy} onClick={() => onSave(selected)}>
          {busy ? "Saving…" : "Save access"}
        </button>
      )}
    </div>
  );
}
