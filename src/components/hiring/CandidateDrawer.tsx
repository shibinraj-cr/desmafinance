"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatHiringDate, formatHiringDateTime } from "@/lib/hiring/core";
import { SCORECARD_VERDICT_LABELS, INTERVIEW_KIND_LABELS } from "@/lib/hiring/constants";
import type { ScorecardVerdict, InterviewKind } from "@/lib/hiring/constants";
import { Markdown } from "./Markdown";

/**
 * The candidate drawer. Opens OVER whatever list you were on and never
 * navigates away from it — the whole point is that you can work a list without
 * losing your place in it.
 *
 * It fetches on open rather than being handed data by the list, because the
 * list row carries a summary and the drawer needs the whole person: answers,
 * timeline, notes, interviews, offers.
 */

type Detail = {
  application: {
    id: string; fullName: string; email: string | null; phone: string | null;
    jobId: string; jobTitle: string; department: string;
    stageId: string | null; stageName: string | null; status: string;
    aiScore: number | null; needsAttention: boolean; screenedOutReason: string | null;
    rejectionReason: string | null; appliedAt: string; daysInStage: number;
    lastContactedAt: string | null; nextFollowUpAt: string | null;
    sourceLabel: string; ownerName: string | null; resumeUrl: string | null;
  };
  candidate: {
    id: string; fullName: string; email: string | null; phone: string | null;
    currentTitle: string | null; currentEmployer: string | null; locationText: string | null;
    totalExperienceYears: number | null; noticePeriodDays: number | null;
    currentCtcLakh: number | null; expectedCtcLakh: number | null;
    resumeUrl: string | null; portfolioUrl: string | null; linkedinUrl: string | null;
    tags: string[]; humanEditedFields: string[]; consentAt: string | null;
  };
  job: {
    id: string;
    title: string;
    mustHaves: string[];
    stages: { id: string; name: string; kind: string }[];
    questions: { id: string; prompt: string }[];
  };
  answers: Record<string, unknown>;
  aiScoreBreakdown: { criterion: string; weight: number; score: number; evidence: string }[] | null;
  events: { id: string; type: string; fromStage: string | null; toStage: string | null; actorName: string | null; occurredAt: string }[];
  notes: { id: string; bodyMd: string; visibility: string; authorName: string; createdAt: string }[];
  interviews: {
    id: string; kind: string; scheduledAt: string; durationMin: number; mode: string; status: string;
    scorecards: { id: string; reviewerName: string; overall: string; notesMd: string | null; submittedAt: string }[];
  }[];
  offers: { id: string; status: string; baseLakh: number; startDate: string | null; expiresAt: string | null }[];
};

const TABS = ["Profile", "Application", "Activity", "Interviews", "Notes", "Files"] as const;
type Tab = (typeof TABS)[number];

const btn =
  "h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-60";
const primaryBtn =
  "h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition disabled:opacity-60";

export function CandidateDrawer({
  applicationId,
  onClose,
  onChanged,
  canMove,
  canWrite,
  aiEnabled = false,
}: {
  applicationId: string;
  onClose: () => void;
  onChanged: () => void;
  canMove: boolean;
  canWrite: boolean;
  /** Hides the AI actions entirely when no key is configured — a button that
   *  can only ever fail is worse than no button. */
  aiEnabled?: boolean;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<Tab>("Profile");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/hiring/applications/${applicationId}`);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      setError(d.message ?? "Could not load this candidate.");
      return;
    }
    setDetail((await res.json()) as Detail);
  }, [applicationId]);

  useEffect(() => {
    setMounted(true);
    void load();
  }, [load]);

  // Escape closes, and focus is trapped to the panel while it is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function act(url: string, body: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      setError(d.message ?? "That didn't work.");
      return false;
    }
    await load();
    onChanged();
    return true;
  }

  if (!mounted) return null;

  const body = (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Candidate">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />
      <div className="relative w-full sm:max-w-2xl h-full bg-surface-container-lowest border-l border-outline-variant shadow-xl overflow-y-auto">
        {!detail ? (
          <DrawerSkeleton error={error} onClose={onClose} />
        ) : (
          <>
            <header className="sticky top-0 z-10 bg-surface-container-lowest border-b border-outline-variant p-lg">
              <div className="flex items-start justify-between gap-md">
                <div className="min-w-0">
                  <h2 className="text-h2 text-on-surface truncate">{detail.candidate.fullName}</h2>
                  <p className="text-body-sm text-on-surface-variant">
                    {detail.application.jobTitle} · {detail.application.department} ·{" "}
                    {detail.application.sourceLabel}
                  </p>
                </div>
                <div className="flex items-center gap-sm flex-shrink-0">
                  {detail.application.aiScore != null && (
                    <ScoreChip score={detail.application.aiScore} breakdown={detail.aiScoreBreakdown} />
                  )}
                  <button type="button" className={btn} onClick={onClose} aria-label="Close">
                    ✕
                  </button>
                </div>
              </div>

              {detail.application.needsAttention && detail.application.screenedOutReason && (
                <p className="mt-sm rounded-lg border border-error bg-error-container px-md py-sm text-body-sm text-on-error-container">
                  ⚑ {detail.application.screenedOutReason} — check this yourself before deciding.
                </p>
              )}

              {error && (
                <p role="alert" className="mt-sm rounded-lg border border-error bg-error-container px-md py-sm text-body-sm text-on-error-container">
                  {error}
                </p>
              )}

              <StageBar
                detail={detail}
                canMove={canMove}
                busy={busy}
                onMove={(toStageId, reason) =>
                  act(`/api/hiring/applications/${detail.application.id}/move`, { toStageId, reason })
                }
              />

              {canWrite && aiEnabled && (
                <AiActions
                  applicationId={detail.application.id}
                  candidateId={detail.candidate.id}
                  hasResume={!!detail.candidate.resumeUrl}
                  scored={detail.application.aiScore != null}
                  busy={busy}
                  onRun={async (url) => {
                    const ok = await act(url, {});
                    return ok;
                  }}
                />
              )}

              <nav className="mt-md flex flex-wrap gap-xs" aria-label="Candidate sections">
                {TABS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    aria-current={tab === t ? "page" : undefined}
                    className={
                      "h-8 px-md rounded-full text-label-sm border transition " +
                      (tab === t
                        ? "bg-primary text-on-primary border-primary"
                        : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
                    }
                  >
                    {t}
                    {t === "Notes" && detail.notes.length > 0 && (
                      <span className="ml-xs opacity-70">{detail.notes.length}</span>
                    )}
                    {t === "Interviews" && detail.interviews.length > 0 && (
                      <span className="ml-xs opacity-70">{detail.interviews.length}</span>
                    )}
                  </button>
                ))}
              </nav>
            </header>

            <div className="p-lg space-y-lg">
              {tab === "Profile" && <ProfileTab detail={detail} />}
              {tab === "Application" && <ApplicationTab detail={detail} />}
              {tab === "Activity" && <ActivityTab detail={detail} />}
              {tab === "Interviews" && <InterviewsTab detail={detail} />}
              {tab === "Notes" && (
                <NotesTab
                  detail={detail}
                  canWrite={canWrite}
                  busy={busy}
                  onAdd={(bodyMd, visibility) =>
                    act(`/api/hiring/applications/${detail.application.id}/notes`, { bodyMd, visibility })
                  }
                />
              )}
              {tab === "Files" && <FilesTab detail={detail} />}
            </div>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

function DrawerSkeleton({ error, onClose }: { error: string | null; onClose: () => void }) {
  if (error) {
    return (
      <div className="p-lg">
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container">
          {error}
        </div>
        <button type="button" className={btn + " mt-md"} onClick={onClose}>
          Close
        </button>
      </div>
    );
  }
  // Skeleton matches the real layout so nothing jumps when it loads.
  return (
    <div className="p-lg space-y-md animate-pulse" aria-busy="true" aria-label="Loading candidate">
      <div className="h-8 w-2/3 rounded bg-surface-container" />
      <div className="h-4 w-1/2 rounded bg-surface-container" />
      <div className="h-9 w-full rounded bg-surface-container" />
      <div className="h-32 w-full rounded bg-surface-container" />
      <div className="h-32 w-full rounded bg-surface-container" />
    </div>
  );
}

function ScoreChip({
  score,
  breakdown,
}: {
  score: number;
  breakdown: { criterion: string; weight: number; score: number; evidence: string }[] | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="h-9 px-md rounded-lg bg-surface-container text-on-surface font-semibold tabular-nums text-body-md"
        title="How this score was reached"
      >
        {score}
      </button>
      {open && (
        <div className="absolute right-0 mt-xs w-80 z-20 rounded-xl border border-outline-variant bg-surface-container-lowest p-md shadow-lg">
          {!breakdown?.length ? (
            <p className="text-body-sm text-on-surface-variant">
              No breakdown was stored for this score.
            </p>
          ) : (
            <ul className="space-y-sm">
              {breakdown.map((b) => (
                <li key={b.criterion}>
                  <div className="flex items-baseline justify-between text-body-sm">
                    <span className="text-on-surface">{b.criterion}</span>
                    <span className="text-on-surface-variant tabular-nums">
                      {b.score}/4 · {b.weight}%
                    </span>
                  </div>
                  <p className="text-caption text-on-surface-variant italic">&ldquo;{b.evidence}&rdquo;</p>
                </li>
              ))}
            </ul>
          )}
          <p className="text-caption text-on-surface-variant mt-sm pt-sm border-t border-outline-variant">
            A score ranks; it never decides. Every stage change is made by a person.
          </p>
        </div>
      )}
    </div>
  );
}

function StageBar({
  detail,
  canMove,
  busy,
  onMove,
}: {
  detail: Detail;
  canMove: boolean;
  busy: boolean;
  onMove: (toStageId: string, reason: string | null) => Promise<boolean>;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const stages = detail.job.stages;
  const current = stages.find((s) => s.id === detail.application.stageId);
  const lostStage = stages.find((s) => s.kind === "lost");

  return (
    <div className="mt-md space-y-sm">
      <div className="flex flex-wrap items-center gap-sm">
        <label className="text-label-sm text-on-surface-variant" htmlFor="drawer-stage">
          Stage
        </label>
        <select
          id="drawer-stage"
          className="h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
          value={detail.application.stageId ?? ""}
          disabled={!canMove || busy}
          onChange={(e) => {
            const target = stages.find((s) => s.id === e.target.value);
            if (target?.kind === "lost") {
              setRejecting(true);
              return;
            }
            void onMove(e.target.value, null);
          }}
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="text-label-sm text-on-surface-variant">
          {detail.application.daysInStage}d in {current?.name ?? "this stage"}
        </span>
        {canMove && lostStage && detail.application.status !== "rejected" && (
          <button type="button" className={btn + " ml-auto"} onClick={() => setRejecting(true)}>
            Reject
          </button>
        )}
      </div>

      {detail.application.status === "rejected" && detail.application.rejectionReason && (
        <p className="text-body-sm text-on-surface-variant">
          Rejected — {detail.application.rejectionReason}
        </p>
      )}

      {rejecting && lostStage && (
        <div className="rounded-lg border border-outline-variant bg-surface-container-low p-md">
          <label className="block text-label-sm text-on-surface-variant mb-xs" htmlFor="reject-reason">
            Why is this candidate not moving forward?
          </label>
          <input
            id="reject-reason"
            className="w-full h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
          <p className="text-caption text-on-surface-variant mt-xs">
            This is kept on the application. Nothing is deleted — a rejection is an event, not an erasure.
          </p>
          <div className="mt-sm flex gap-xs">
            <button
              type="button"
              className={primaryBtn}
              disabled={!reason.trim() || busy}
              onClick={async () => {
                const ok = await onMove(lostStage.id, reason);
                if (ok) {
                  setRejecting(false);
                  setReason("");
                }
              }}
            >
              Reject
            </button>
            <button type="button" className={btn} onClick={() => setRejecting(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-md py-xs border-b border-outline-variant last:border-0">
      <span className="text-label-sm text-on-surface-variant uppercase tracking-wider">{label}</span>
      <span className="text-body-md text-on-surface text-right">{value || "—"}</span>
    </div>
  );
}

function ProfileTab({ detail }: { detail: Detail }) {
  const c = detail.candidate;
  return (
    <section>
      <h3 className="text-h3 text-on-surface mb-sm">Profile</h3>
      <Row label="Email" value={c.email} />
      <Row label="Phone" value={c.phone} />
      <Row label="Current role" value={c.currentTitle} />
      <Row label="Employer" value={c.currentEmployer} />
      <Row label="Location" value={c.locationText} />
      <Row label="Experience" value={c.totalExperienceYears == null ? null : `${c.totalExperienceYears} years`} />
      <Row label="Notice period" value={c.noticePeriodDays == null ? null : `${c.noticePeriodDays} days`} />
      <Row label="Expected CTC" value={c.expectedCtcLakh == null ? null : `₹${c.expectedCtcLakh} LPA`} />
      <Row label="Owner" value={detail.application.ownerName} />
      <Row label="Applied" value={formatHiringDate(detail.application.appliedAt)} />
      <Row label="Consent given" value={c.consentAt ? formatHiringDate(c.consentAt) : "Not via the careers page"} />
      {c.tags.length > 0 && (
        <div className="mt-sm flex flex-wrap gap-xs">
          {c.tags.map((t) => (
            <span key={t} className="h-6 inline-flex items-center px-sm rounded-full bg-surface-container text-label-sm">
              {t}
            </span>
          ))}
        </div>
      )}
      {c.humanEditedFields.length > 0 && (
        <p className="text-caption text-on-surface-variant mt-md">
          Edited by hand: {c.humanEditedFields.join(", ")}. Re-parsing a résumé will not overwrite these.
        </p>
      )}
    </section>
  );
}

function ApplicationTab({ detail }: { detail: Detail }) {
  const answers = detail.answers as Record<string, string | string[]>;
  const entries = Object.entries(answers ?? {});
  return (
    <section className="space-y-lg">
      <div>
        <h3 className="text-h3 text-on-surface mb-sm">Screening answers</h3>
        {entries.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">
            No screening answers — this application did not come through the careers form.
          </p>
        ) : (
          <dl className="space-y-md">
            {entries.map(([qid, value]) => (
              <div key={qid}>
                <dt className="text-label-sm text-on-surface-variant">
                  {questionPrompt(detail, qid)}
                </dt>
                <dd className="text-body-md text-on-surface whitespace-pre-wrap mt-xs">
                  {Array.isArray(value) ? value.join(", ") : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {detail.job.mustHaves.length > 0 && (
        <div>
          <h3 className="text-h3 text-on-surface mb-sm">Must-haves on this req</h3>
          <ul className="list-disc pl-lg space-y-xs text-body-md text-on-surface-variant">
            {detail.job.mustHaves.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * The answers blob is keyed by question id. A question deleted since the
 * application was submitted has no prompt any more — the ANSWER is still shown,
 * because throwing away what someone wrote because the form changed would be
 * the worse failure.
 */
function questionPrompt(detail: Detail, qid: string): string {
  return detail.job.questions.find((x) => x.id === qid)?.prompt ?? "Answer (question since removed)";
}

const EVENT_LABELS: Record<string, string> = {
  created: "Applied",
  stage_moved: "Moved stage",
  scored: "Scored",
  note: "Note added",
  email_sent: "Email sent",
  whatsapp_sent: "WhatsApp sent",
  whatsapp_received: "WhatsApp received",
  interview_scheduled: "Interview scheduled",
  scorecard_submitted: "Scorecard submitted",
  offer_sent: "Offer sent",
  offer_signed: "Offer signed",
  rejected: "Rejected",
  reopened: "Reopened",
  automation_fired: "Automation fired",
};

function ActivityTab({ detail }: { detail: Detail }) {
  return (
    <section>
      <h3 className="text-h3 text-on-surface mb-sm">Activity</h3>
      <p className="text-caption text-on-surface-variant mb-md">
        Append-only. Every funnel number in analytics is computed from exactly these rows.
      </p>
      <ol className="space-y-md">
        {detail.events.map((e) => (
          <li key={e.id} className="flex gap-sm">
            <div className="mt-xs h-2 w-2 rounded-full bg-primary flex-shrink-0" aria-hidden />
            <div className="min-w-0">
              <div className="text-body-md text-on-surface">
                {EVENT_LABELS[e.type] ?? e.type}
                {e.fromStage && e.toStage && (
                  <span className="text-on-surface-variant">
                    {" "}
                    · {e.fromStage} → {e.toStage}
                  </span>
                )}
                {!e.fromStage && e.toStage && (
                  <span className="text-on-surface-variant"> · {e.toStage}</span>
                )}
              </div>
              <div className="text-caption text-on-surface-variant">
                {formatHiringDateTime(e.occurredAt)} · {e.actorName ?? "System"}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function InterviewsTab({ detail }: { detail: Detail }) {
  if (detail.interviews.length === 0) {
    return (
      <section>
        <h3 className="text-h3 text-on-surface mb-xs">Interviews</h3>
        <p className="text-body-sm text-on-surface-variant">
          None booked yet.
        </p>
      </section>
    );
  }
  return (
    <section className="space-y-md">
      <h3 className="text-h3 text-on-surface">Interviews</h3>
      {detail.interviews.map((i) => (
        <div key={i.id} className="rounded-lg border border-outline-variant p-md">
          <div className="flex flex-wrap items-baseline justify-between gap-sm">
            <span className="text-body-md text-on-surface font-medium">
              {INTERVIEW_KIND_LABELS[i.kind as InterviewKind] ?? i.kind}
            </span>
            <span className="text-label-sm text-on-surface-variant">
              {formatHiringDateTime(i.scheduledAt)} · {i.durationMin} min · {i.status}
            </span>
          </div>
          {i.scorecards.length === 0 ? (
            <p className="text-caption text-on-surface-variant mt-xs">
              {i.status === "completed"
                ? "Awaiting scorecards."
                : "Scorecards appear here once the interview is done."}
            </p>
          ) : (
            <ul className="mt-sm space-y-sm">
              {i.scorecards.map((s) => (
                <li key={s.id}>
                  <div className="text-body-sm text-on-surface">
                    {s.reviewerName} —{" "}
                    <strong>{SCORECARD_VERDICT_LABELS[s.overall as ScorecardVerdict] ?? s.overall}</strong>
                  </div>
                  {s.notesMd && <Markdown source={s.notesMd} className="mt-xs" />}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}

function NotesTab({
  detail,
  canWrite,
  busy,
  onAdd,
}: {
  detail: Detail;
  canWrite: boolean;
  busy: boolean;
  onAdd: (bodyMd: string, visibility: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [visibility, setVisibility] = useState("team");
  return (
    <section className="space-y-md">
      <h3 className="text-h3 text-on-surface">Notes</h3>

      {canWrite && (
        <div className="rounded-lg border border-outline-variant p-md">
          <label className="sr-only" htmlFor="note-body">
            Add a note
          </label>
          <textarea
            id="note-body"
            className="w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
            rows={3}
            value={draft}
            placeholder="What did you learn?"
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="mt-sm flex items-center gap-sm">
            <select
              className="h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              aria-label="Who can see this note"
            >
              <option value="team">The hiring team</option>
              <option value="private">Only me</option>
            </select>
            <button
              type="button"
              className={primaryBtn}
              disabled={!draft.trim() || busy}
              onClick={async () => {
                const ok = await onAdd(draft, visibility);
                if (ok) setDraft("");
              }}
            >
              Add note
            </button>
          </div>
        </div>
      )}

      {detail.notes.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">
          No notes yet. Notes are how the next person to open this knows what you already found out.
        </p>
      ) : (
        <ul className="space-y-md">
          {detail.notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-outline-variant p-md">
              <div className="flex items-baseline justify-between gap-sm text-caption text-on-surface-variant">
                <span>{n.authorName}</span>
                <span>
                  {formatHiringDateTime(n.createdAt)}
                  {n.visibility === "private" && " · private"}
                </span>
              </div>
              <Markdown source={n.bodyMd} className="mt-xs" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FilesTab({ detail }: { detail: Detail }) {
  const links = [
    { label: "Résumé", url: detail.candidate.resumeUrl },
    { label: "Portfolio", url: detail.candidate.portfolioUrl },
    { label: "LinkedIn", url: detail.candidate.linkedinUrl },
  ].filter((l) => l.url);

  return (
    <section>
      <h3 className="text-h3 text-on-surface mb-sm">Files and links</h3>
      {links.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">
          Nothing attached. A candidate added by hand or imported from a spreadsheet often has none.
        </p>
      ) : (
        <ul className="space-y-xs">
          {links.map((l) => (
            <li key={l.label}>
              <a
                href={l.url!}
                target="_blank"
                rel="noopener noreferrer"
                className="text-body-md text-primary hover:underline"
              >
                {l.label} ↗
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The two AI actions that belong on a person: score this application against
 * the req's rubric, and read the résumé into the blank fields.
 *
 * Both say what they will and will not do. Re-scoring is offered explicitly
 * because the supported way to see a rubric change take effect is to re-run it.
 */
function AiActions({
  applicationId,
  candidateId,
  hasResume,
  scored,
  busy,
  onRun,
}: {
  applicationId: string;
  candidateId: string;
  hasResume: boolean;
  scored: boolean;
  busy: boolean;
  onRun: (url: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="mt-sm flex flex-wrap items-center gap-xs">
      <button
        type="button"
        className={btn}
        disabled={busy}
        onClick={async () => {
          setNote(null);
          const ok = await onRun(`/api/hiring/applications/${applicationId}/score`);
          if (ok) setNote("Scored. The breakdown is behind the score chip.");
        }}
      >
        {scored ? "Re-score" : "Score against the rubric"}
      </button>

      <button
        type="button"
        className={btn}
        disabled={busy || !hasResume}
        title={hasResume ? undefined : "There is no résumé on file."}
        onClick={async () => {
          setNote(null);
          const ok = await onRun(`/api/hiring/candidates/${candidateId}/parse-resume`);
          if (ok) setNote("Résumé read. Blank fields were filled; anything edited by hand was left alone.");
        }}
      >
        Read the résumé
      </button>

      {note && <span className="text-caption text-on-surface-variant">{note}</span>}
    </div>
  );
}
