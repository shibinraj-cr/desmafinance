"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshBar } from "@/components/hiring/RefreshBar";
import { letterHtml } from "@/lib/hiring/letter";
import { totalCtcLakh, formatHiringDate, compBandLabel } from "@/lib/hiring/core";
import type { OfferDTO } from "@/lib/hiring/offers";

type CandidateOption = {
  applicationId: string; name: string; email: string | null; stageName: string | null;
  jobId: string; jobTitle: string; department: string; locationId: string | null;
  compMinLakh: number | null; compMaxLakh: number | null;
};

const btn =
  "h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-60";
const primaryBtn =
  "h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition disabled:opacity-60";
const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md";

export function OffersClient({
  offers,
  candidates,
  locations,
  canApprove,
  currentUserId,
  loadedAt,
}: {
  offers: OfferDTO[];
  candidates: CandidateOption[];
  locations: { id: string; name: string }[];
  canApprove: boolean;
  currentUserId: string;
  loadedAt: string;
}) {
  const router = useRouter();
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function call(label: string, url: string, body?: unknown, method = "POST") {
    setBusy(label);
    setError(null);
    setBlockers(null);
    const res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(null);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string; blockers?: string[] };
      if (d.blockers?.length) setBlockers(d.blockers);
      else setError(d.message ?? "That didn't work.");
      return null;
    }
    router.refresh();
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }

  return (
    <div className="space-y-lg">
      {error && (
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container">
          {error}
        </div>
      )}
      {blockers && (
        <div className="rounded-xl border border-outline-variant bg-primary-fixed/40 p-md">
          <div className="text-body-md text-on-surface font-semibold mb-xs">This offer cannot go out yet</div>
          <ul className="list-disc pl-lg space-y-xs text-body-md text-on-surface-variant">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-md">
        <div>
          <h2 className="text-h2 text-on-surface">Offers</h2>
          <p className="text-body-sm text-on-surface-variant">
            An offer above the requisition&rsquo;s band needs an approval before it can be sent, and
            the person who wrote it cannot be the one who approves it.
          </p>
        </div>
        <div className="flex items-center gap-xs">
          <RefreshBar loadedAt={loadedAt} label={`${offers.length} offers`} />
          <button
            type="button"
            className={primaryBtn}
            onClick={() => setSimulating((v) => !v)}
            disabled={candidates.length === 0}
          >
            {simulating ? "Close simulator" : "New offer"}
          </button>
        </div>
      </div>

      {simulating && (
        <Simulator
          candidates={candidates}
          locations={locations}
          busy={busy === "create"}
          onCancel={() => setSimulating(false)}
          onSubmit={async (body) => {
            const ok = await call("create", "/api/hiring/offers", body);
            if (ok) setSimulating(false);
          }}
        />
      )}

      {offers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-xl text-center">
          <div className="text-body-lg text-on-surface mb-xs">No offers yet</div>
          <p className="text-body-sm text-on-surface-variant max-w-prose mx-auto mb-md">
            The simulator writes the terms, shows you the letter as the candidate will see it, and
            sends a signing link that expires.
          </p>
          {candidates.length > 0 && (
            <button type="button" className={primaryBtn} onClick={() => setSimulating(true)}>
              Write the first offer
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-sm">
          {offers.map((o) => (
            <li key={o.id} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
              <div className="flex flex-wrap items-start justify-between gap-md">
                <div className="min-w-0">
                  <div className="text-body-lg font-semibold text-on-surface">{o.candidateName}</div>
                  <div className="text-body-sm text-on-surface-variant">
                    {o.jobTitle}
                    {o.department ? ` · ${o.department}` : ""}
                    {o.locationName ? ` · ${o.locationName}` : ""}
                  </div>
                  <div className="text-caption text-on-surface-variant mt-xs">
                    ₹{o.totalCtcLakh} LPA total · base ₹{o.baseLakh}
                    {o.startDate ? ` · starts ${formatHiringDate(o.startDate)}` : ""}
                    {o.expiresAt ? ` · expires ${formatHiringDate(o.expiresAt)}` : ""}
                  </div>
                  {!o.withinBand && (
                    <div className="text-caption text-error mt-xs">
                      ₹{o.overBy} lakh over the requisition&rsquo;s band (max ₹{o.bandMaxLakh} lakh)
                      {o.approvedAt ? " — approved" : " — needs approval"}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-xs">
                  <OfferStatus status={o.status} signedAt={o.signedAt} />

                  {o.status === "pending_approval" && canApprove && (
                    <>
                      <button
                        type="button"
                        className={primaryBtn}
                        disabled={busy !== null}
                        onClick={() => call(`ap-${o.id}`, `/api/hiring/offers/${o.id}/approve`, { decision: "approve" })}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className={btn}
                        disabled={busy !== null}
                        onClick={() => call(`rj-${o.id}`, `/api/hiring/offers/${o.id}/approve`, { decision: "reject" })}
                      >
                        Reject
                      </button>
                    </>
                  )}

                  {o.status === "draft" && (
                    <button
                      type="button"
                      className={primaryBtn}
                      disabled={busy !== null}
                      onClick={() => call(`send-${o.id}`, `/api/hiring/offers/${o.id}/send`)}
                    >
                      {busy === `send-${o.id}` ? "Sending…" : "Send for signature"}
                    </button>
                  )}

                  {o.pdfUrl && (
                    <a className={btn} href={o.pdfUrl} target="_blank" rel="noopener noreferrer">
                      Signed PDF ↗
                    </a>
                  )}

                  {o.status !== "accepted" && o.status !== "withdrawn" && (
                    <button
                      type="button"
                      className={btn}
                      disabled={busy !== null}
                      onClick={() => call(`wd-${o.id}`, `/api/hiring/offers/${o.id}/withdraw`, {})}
                    >
                      Withdraw
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OfferStatus({ status, signedAt }: { status: string; signedAt: string | null }) {
  const label = signedAt ? "Signed" : status.replace("_", " ");
  const tone = signedAt
    ? "bg-primary text-on-primary"
    : status === "pending_approval"
      ? "bg-error-container text-on-error-container"
      : status === "sent" || status === "viewed"
        ? "bg-primary-fixed text-on-surface"
        : "bg-surface-container text-on-surface-variant";
  return <span className={"inline-flex items-center h-6 px-sm rounded-full text-label-sm " + tone}>{label}</span>;
}

/**
 * The simulator. The letter preview is rendered from the SAME `letterHtml` the
 * envelope archives, so what the recruiter reads here is what the candidate
 * opens — not a lookalike that drifts.
 */
function Simulator({
  candidates,
  locations,
  busy,
  onCancel,
  onSubmit,
}: {
  candidates: CandidateOption[];
  locations: { id: string; name: string }[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [applicationId, setApplicationId] = useState(candidates[0]?.applicationId ?? "");
  const chosen = candidates.find((c) => c.applicationId === applicationId) ?? candidates[0];

  const [baseLakh, setBaseLakh] = useState("");
  const [variableLakh, setVariableLakh] = useState("");
  const [joiningBonusLakh, setJoiningBonusLakh] = useState("");
  const [startDate, setStartDate] = useState("");
  const [probationMonths, setProbationMonths] = useState("6");
  const [noticePeriodDays, setNoticePeriodDays] = useState("30");
  const [expiresAt, setExpiresAt] = useState("");
  const [otherTermsMd, setOtherTermsMd] = useState("");
  const [locationId, setLocationId] = useState(chosen?.locationId ?? "");

  const base = num(baseLakh) ?? 0;
  const total = totalCtcLakh({
    baseLakh: base,
    variableLakh: num(variableLakh),
    joiningBonusLakh: num(joiningBonusLakh),
  });
  const overBand = chosen?.compMaxLakh != null && base > chosen.compMaxLakh;

  const previewHtml = useMemo(() => {
    if (!chosen) return "";
    return letterHtml({
      candidateName: chosen.name,
      jobTitle: chosen.jobTitle,
      department: chosen.department,
      locationName: locations.find((l) => l.id === locationId)?.name ?? null,
      startDate: startDate ? new Date(startDate) : null,
      baseLakh: base,
      variableLakh: num(variableLakh),
      joiningBonusLakh: num(joiningBonusLakh),
      probationMonths: num(probationMonths),
      noticePeriodDays: num(noticePeriodDays),
      otherTermsMd: otherTermsMd || null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    });
  }, [chosen, locations, locationId, startDate, base, variableLakh, joiningBonusLakh, probationMonths, noticePeriodDays, otherTermsMd, expiresAt]);

  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-low p-lg space-y-md">
      <h3 className="text-h3 text-on-surface">Offer simulator</h3>

      <label className="block">
        <span className="block text-label-sm text-on-surface-variant mb-xs">Candidate</span>
        <select
          className={inputCls}
          value={applicationId}
          onChange={(e) => {
            setApplicationId(e.target.value);
            const next = candidates.find((c) => c.applicationId === e.target.value);
            setLocationId(next?.locationId ?? "");
          }}
        >
          {candidates.map((c) => (
            <option key={c.applicationId} value={c.applicationId}>
              {c.name} · {c.jobTitle}
              {c.stageName ? ` · ${c.stageName}` : ""}
            </option>
          ))}
        </select>
        {chosen && !chosen.email && (
          <span className="block text-caption text-error mt-xs">
            This candidate has no email address, and the signing link goes by email. Add one first.
          </span>
        )}
      </label>

      <div className="grid gap-md sm:grid-cols-4">
        <Field label="Base (₹ lakh/yr)">
          <input className={inputCls} type="number" min={0} step="0.25" value={baseLakh} onChange={(e) => setBaseLakh(e.target.value)} />
        </Field>
        <Field label="Variable (₹ lakh/yr)">
          <input className={inputCls} type="number" min={0} step="0.25" value={variableLakh} onChange={(e) => setVariableLakh(e.target.value)} />
        </Field>
        <Field label="Joining bonus (₹ lakh)">
          <input className={inputCls} type="number" min={0} step="0.25" value={joiningBonusLakh} onChange={(e) => setJoiningBonusLakh(e.target.value)} />
        </Field>
        <Field label="Start date">
          <input className={inputCls} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
      </div>

      <div className="grid gap-md sm:grid-cols-4">
        <Field label="Probation (months)">
          <input className={inputCls} type="number" min={0} max={36} value={probationMonths} onChange={(e) => setProbationMonths(e.target.value)} />
        </Field>
        <Field label="Notice (days)">
          <input className={inputCls} type="number" min={0} max={365} value={noticePeriodDays} onChange={(e) => setNoticePeriodDays(e.target.value)} />
        </Field>
        <Field label="Offer expires">
          <input className={inputCls} type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </Field>
        <Field label="Place of work">
          <select className={inputCls} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Not stated</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Other terms (optional)">
        <textarea
          className="w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
          rows={3}
          value={otherTermsMd}
          onChange={(e) => setOtherTermsMd(e.target.value)}
        />
      </Field>

      <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
        <div className="flex flex-wrap items-baseline justify-between gap-md">
          <span className="text-h3 text-on-surface">₹{total} LPA total</span>
          {chosen && (
            <span className="text-body-sm text-on-surface-variant">
              Requisition band: {compBandLabel(chosen.compMinLakh, chosen.compMaxLakh) ?? "not stated"}
            </span>
          )}
        </div>
        {overBand && (
          <p className="text-body-sm text-error mt-xs">
            Over the band. This will be created as <strong>pending approval</strong> and cannot be
            sent until someone else approves it.
          </p>
        )}
      </div>

      <details className="rounded-lg border border-outline-variant bg-surface-container-lowest">
        <summary className="cursor-pointer px-md py-sm text-label-sm text-on-surface-variant">
          Preview the letter as the candidate will see it
        </summary>
        <div
          className="offer-letter p-lg border-t border-outline-variant text-body-md text-on-surface"
          // Generated by letterHtml() from escaped values — the same function
          // whose output is archived on the envelope.
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      </details>

      <div className="flex gap-xs">
        <button
          type="button"
          className={primaryBtn}
          disabled={busy || !applicationId || base <= 0}
          onClick={() =>
            onSubmit({
              applicationId,
              locationId: locationId || null,
              startDate: startDate ? new Date(`${startDate}T00:00:00+05:30`).toISOString() : null,
              baseLakh: base,
              variableLakh: num(variableLakh),
              joiningBonusLakh: num(joiningBonusLakh),
              otherTermsMd: otherTermsMd || null,
              probationMonths: num(probationMonths),
              noticePeriodDays: num(noticePeriodDays),
              expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:00+05:30`).toISOString() : null,
            })
          }
        >
          {busy ? "Creating…" : overBand ? "Create and route for approval" : "Create offer"}
        </button>
        <button type="button" className={btn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">{label}</span>
      {children}
    </label>
  );
}

function num(v: string): number | null {
  const n = Number(v);
  return v.trim() === "" || !Number.isFinite(n) ? null : n;
}
