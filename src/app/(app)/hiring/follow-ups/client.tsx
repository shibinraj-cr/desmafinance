"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshBar } from "@/components/hiring/RefreshBar";
import { CandidateDrawer } from "@/components/hiring/CandidateDrawer";
import { GROUP_LABELS, GROUP_BLURBS, suggestedAction, type FollowUpGroup, type FollowUpRow } from "@/lib/hiring/follow-ups";
import { formatHiringDate } from "@/lib/hiring/core";

const ORDER: FollowUpGroup[] = ["overdue", "due_today", "silent"];

const btn =
  "h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-60";
const primaryBtn =
  "h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition disabled:opacity-60";

export function FollowUpsClient({
  groups,
  total,
  ownedOnly,
  canMove,
  canWrite,
  aiEnabled,
  loadedAt,
}: {
  groups: Record<FollowUpGroup, FollowUpRow[]>;
  total: number;
  ownedOnly: boolean;
  canMove: boolean;
  canWrite: boolean;
  aiEnabled: boolean;
  loadedAt: string;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function schedule(applicationId: string, days: number | null) {
    setBusy(applicationId);
    setError(null);
    const when = days == null ? null : new Date(Date.now() + days * 86_400_000).toISOString();
    const res = await fetch(`/api/hiring/applications/${applicationId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nextFollowUpAt: when }),
    });
    setBusy(null);
    if (!res.ok) {
      setError("That didn't save.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-lg">
      {error && (
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-md">
        <label className="flex items-center gap-xs text-body-md text-on-surface">
          <input
            type="checkbox"
            className="accent-primary"
            checked={ownedOnly}
            onChange={(e) => router.push(e.target.checked ? "/hiring/follow-ups?owned=1" : "/hiring/follow-ups")}
          />
          Mine only
        </label>
        <RefreshBar loadedAt={loadedAt} label={`${total} to chase`} />
      </div>

      {total === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-xl text-center">
          <div className="text-body-lg text-on-surface mb-xs">Nothing to chase</div>
          <p className="text-body-sm text-on-surface-variant max-w-prose mx-auto">
            Nobody is overdue, nothing is due today, and no shortlisted candidate has been left
            waiting. This screen fills itself back up on its own.
          </p>
        </div>
      ) : (
        ORDER.map((group) => {
          const rows = groups[group];
          if (!rows.length) return null;
          return (
            <section key={group} className="space-y-sm">
              <div>
                <h2 className="text-h3 text-on-surface">
                  {GROUP_LABELS[group]}{" "}
                  <span className="text-on-surface-variant tabular-nums">{rows.length}</span>
                </h2>
                <p className="text-caption text-on-surface-variant">{GROUP_BLURBS[group]}</p>
              </div>

              <ul className="space-y-sm">
                {rows.map((row) => (
                  <li
                    key={row.id}
                    className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-md">
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => setOpenId(row.id)}
                          className="text-body-lg font-semibold text-on-surface hover:text-primary text-left"
                        >
                          {row.fullName}
                        </button>
                        <div className="text-body-sm text-on-surface-variant">
                          {row.jobTitle} · {row.stageName ?? "no stage"}
                        </div>
                        <div className="text-caption text-on-surface-variant mt-xs">
                          {row.daysSinceContact == null
                            ? "Never contacted"
                            : `Last contact ${row.daysSinceContact}d ago`}
                          {row.nextFollowUpAt ? ` · follow-up ${formatHiringDate(row.nextFollowUpAt)}` : ""}
                          {row.ownerName ? ` · ${row.ownerName}` : " · unassigned"}
                        </div>
                        <p className="text-body-sm text-on-surface mt-xs">{suggestedAction(row)}</p>
                      </div>

                      <div className="flex flex-wrap items-center gap-xs">
                        {row.phone && (
                          <a className={btn} href={`https://wa.me/${row.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">
                            Message
                          </a>
                        )}
                        {row.email && (
                          <a className={btn} href={`mailto:${row.email}`}>
                            Email
                          </a>
                        )}
                        <button
                          type="button"
                          className={btn}
                          disabled={busy === row.id}
                          onClick={() => schedule(row.id, 2)}
                          title="Push the follow-up out by two days"
                        >
                          Snooze 2d
                        </button>
                        <button
                          type="button"
                          className={primaryBtn}
                          disabled={busy === row.id}
                          onClick={() => schedule(row.id, 0)}
                        >
                          {busy === row.id ? "Saving…" : "Chase today"}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      {openId && (
        <CandidateDrawer
          applicationId={openId}
          canMove={canMove}
          canWrite={canWrite}
          aiEnabled={aiEnabled}
          onClose={() => setOpenId(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}
