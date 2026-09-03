"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshBar } from "@/components/hiring/RefreshBar";
import { CandidateDrawer } from "@/components/hiring/CandidateDrawer";
import { Markdown } from "@/components/hiring/Markdown";
import { formatHiringDateTime } from "@/lib/hiring/core";
import { INTERVIEW_KINDS, INTERVIEW_KIND_LABELS, SCORECARD_VERDICTS, SCORECARD_VERDICT_LABELS } from "@/lib/hiring/constants";
import type { InterviewKind, ScorecardVerdict } from "@/lib/hiring/constants";
import type { InterviewRowDTO, InterviewKpis } from "@/lib/hiring/interviews";

type TemplateDTO = {
  id: string; name: string; kind: string; durationMin: number;
  questionSet: string[]; isDefaultForStage: string | null;
};
type UserLite = { id: string; username: string };

const TABS = [
  { key: "schedule", label: "Schedule" },
  { key: "awaiting", label: "Awaiting scorecards" },
  { key: "transcripts", label: "Transcripts & recordings" },
  { key: "templates", label: "Templates & rubrics" },
];

const btn =
  "h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-60";
const primaryBtn =
  "h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition disabled:opacity-60";
const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md";

export function InterviewsClient({
  tab,
  interviews,
  kpis,
  templates,
  users,
  bookable,
  calendarUrl,
  aiEnabled,
  currentUserId,
  loadedAt,
}: {
  tab: string;
  interviews: InterviewRowDTO[];
  kpis: InterviewKpis;
  templates: TemplateDTO[];
  users: UserLite[];
  bookable: { id: string; label: string }[];
  calendarUrl: string;
  aiEnabled: boolean;
  currentUserId: string;
  loadedAt: string;
}) {
  const router = useRouter();
  const [booking, setBooking] = useState(false);
  const [openApplication, setOpenApplication] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [packet, setPacket] = useState<{ id: string; md: string } | null>(null);
  const [scoring, setScoring] = useState<string | null>(null);

  async function call(label: string, url: string, body?: unknown, method = "POST") {
    setBusy(label);
    setError(null);
    const res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(null);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      setError(d.message ?? "That didn't work.");
      return null;
    }
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }

  return (
    <div className="space-y-lg">
      {error && (
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container">
          {error}
        </div>
      )}

      <div className="grid gap-md grid-cols-2 lg:grid-cols-5">
        <Kpi label="Today" value={kpis.today} />
        <Kpi label="Scheduled" value={kpis.scheduled} />
        <Kpi label="Awaiting scores" value={kpis.awaitingScores} tone={kpis.awaitingScores > 0 ? "warn" : undefined} />
        <Kpi label="Scored" value={kpis.scored} />
        <Kpi label="Avg score" value={kpis.avgScore ?? "—"} hint="Panel verdicts as one number, 0–100" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-md">
        <nav className="flex flex-wrap gap-xs" aria-label="Interview views">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/hiring/interviews?tab=${t.key}`}
              aria-current={tab === t.key ? "page" : undefined}
              className={
                "h-8 inline-flex items-center px-md rounded-full text-label-sm border transition " +
                (tab === t.key
                  ? "bg-primary text-on-primary border-primary"
                  : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
              }
            >
              {t.label}
              {t.key === "awaiting" && kpis.awaitingScores > 0 && (
                <span className="ml-xs opacity-70">{kpis.awaitingScores}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-xs">
          <CalendarFeedButton url={calendarUrl} />
          <button type="button" className={primaryBtn} onClick={() => setBooking((v) => !v)} disabled={bookable.length === 0}>
            Book interview
          </button>
          <RefreshBar loadedAt={loadedAt} label={`${interviews.length} shown`} />
        </div>
      </div>

      {booking && (
        <BookPanel
          bookable={bookable}
          templates={templates}
          users={users}
          currentUserId={currentUserId}
          busy={busy === "book"}
          onCancel={() => setBooking(false)}
          onSubmit={async (body) => {
            const ok = await call("book", "/api/hiring/interviews", body);
            if (ok) {
              setBooking(false);
              router.refresh();
            }
          }}
        />
      )}

      {packet && (
        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
          <div className="flex items-start justify-between gap-md mb-sm">
            <h3 className="text-h3 text-on-surface">Prep packet</h3>
            <button type="button" className={btn} onClick={() => setPacket(null)}>
              Close
            </button>
          </div>
          <Markdown source={packet.md} />
        </section>
      )}

      {tab === "templates" ? (
        <TemplatesPanel templates={templates} />
      ) : interviews.length === 0 ? (
        <EmptyInterviews tab={tab} canBook={bookable.length > 0} onBook={() => setBooking(true)} />
      ) : (
        <ul className="space-y-sm">
          {interviews.map((i) => (
            <li key={i.id} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
              <div className="flex flex-wrap items-start justify-between gap-md">
                <div className="min-w-0">
                  <button
                    type="button"
                    className="text-body-lg font-semibold text-on-surface hover:text-primary text-left"
                    onClick={() => setOpenApplication(i.applicationId)}
                  >
                    {i.candidateName}
                  </button>
                  <div className="text-body-sm text-on-surface-variant">
                    {i.jobTitle} · {i.kindLabel} · {i.durationMin} min · {i.mode}
                  </div>
                  <div className="text-caption text-on-surface-variant mt-xs">
                    {formatHiringDateTime(i.scheduledAt)} IST
                    {i.locationOrLink ? ` · ${i.locationOrLink}` : ""}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-xs">
                  <StatusPill status={i.status} awaiting={i.awaitingScores} />
                  {aiEnabled && (
                    <button
                      type="button"
                      className={btn}
                      disabled={busy !== null}
                      onClick={async () => {
                        const r = await call(`packet-${i.id}`, `/api/hiring/interviews/${i.id}/prep-packet`);
                        if (r) setPacket({ id: i.id, md: String(r.prepPacketMd ?? "") });
                      }}
                    >
                      {busy === `packet-${i.id}` ? "Writing…" : i.hasPrepPacket ? "Regenerate packet" : "Prep packet"}
                    </button>
                  )}
                  {i.status === "scheduled" && (
                    <button
                      type="button"
                      className={btn}
                      disabled={busy !== null}
                      onClick={async () => {
                        const ok = await call(`done-${i.id}`, `/api/hiring/interviews/${i.id}`, { status: "completed" }, "PATCH");
                        if (ok) router.refresh();
                      }}
                    >
                      Mark done
                    </button>
                  )}
                  <button type="button" className={primaryBtn} onClick={() => setScoring(scoring === i.id ? null : i.id)}>
                    {scoring === i.id ? "Close" : "Scorecard"}
                  </button>
                </div>
              </div>

              {i.awaitingScores && (
                <p className="mt-sm text-body-sm text-error">
                  No scorecard filed yet
                  {i.missingReviewers.length > 0 &&
                    ` — waiting on ${i.missingReviewers
                      .map((id) => users.find((u) => u.id === id)?.username ?? "someone")
                      .join(", ")}`}
                  .
                </p>
              )}

              {scoring === i.id && (
                <ScorecardForm
                  busy={busy === `score-${i.id}`}
                  onSubmit={async (body) => {
                    const ok = await call(`score-${i.id}`, `/api/hiring/interviews/${i.id}/scorecard`, body);
                    if (ok) {
                      setScoring(null);
                      router.refresh();
                    }
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {openApplication && (
        <CandidateDrawer
          applicationId={openApplication}
          canMove
          canWrite
          aiEnabled={aiEnabled}
          onClose={() => setOpenApplication(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone?: "warn" }) {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md" title={hint}>
      <div className={"text-h1 tabular-nums " + (tone === "warn" && value !== 0 ? "text-error" : "text-on-surface")}>
        {value}
      </div>
      <div className="text-label-sm text-on-surface-variant uppercase tracking-wider">{label}</div>
    </div>
  );
}

function StatusPill({ status, awaiting }: { status: string; awaiting: boolean }) {
  const label = awaiting ? "Awaiting scores" : status.replace("_", " ");
  const tone = awaiting
    ? "bg-error-container text-on-error-container"
    : status === "completed"
      ? "bg-primary text-on-primary"
      : status === "cancelled"
        ? "bg-surface-container text-on-surface-variant"
        : "bg-surface-container-high text-on-surface-variant";
  return <span className={"inline-flex items-center h-6 px-sm rounded-full text-label-sm " + tone}>{label}</span>;
}

/**
 * The ICS URL is a credential, so it is not printed on the page until asked
 * for — and copying it is one action rather than a select-and-drag.
 */
function CalendarFeedButton({ url }: { url: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const full = typeof window === "undefined" ? url : `${window.location.origin}${url}`;

  return (
    <div className="relative">
      <button type="button" className={btn} onClick={() => setShown((v) => !v)}>
        Calendar feed
      </button>
      {shown && (
        <div className="absolute right-0 mt-xs w-96 z-20 rounded-xl border border-outline-variant bg-surface-container-lowest p-md shadow-lg">
          <p className="text-body-sm text-on-surface-variant mb-sm">
            Subscribe to this in Google Calendar or Apple Calendar and your interviews appear there.
            Treat the link as a password — anyone with it can read your interview schedule.
          </p>
          <code className="block text-caption break-all rounded bg-surface-container p-sm">{full}</code>
          <button
            type="button"
            className={primaryBtn + " mt-sm"}
            onClick={async () => {
              await navigator.clipboard.writeText(full);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}
    </div>
  );
}

function BookPanel({
  bookable,
  templates,
  users,
  currentUserId,
  busy,
  onCancel,
  onSubmit,
}: {
  bookable: { id: string; label: string }[];
  templates: TemplateDTO[];
  users: UserLite[];
  currentUserId: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [applicationId, setApplicationId] = useState(bookable[0]?.id ?? "");
  const [templateId, setTemplateId] = useState("");
  const [kind, setKind] = useState<InterviewKind>("phone_screen");
  const [when, setWhen] = useState("");
  const [durationMin, setDurationMin] = useState(30);
  const [mode, setMode] = useState("video");
  const [locationOrLink, setLocationOrLink] = useState("");
  const [panel, setPanel] = useState<string[]>([currentUserId]);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setKind(t.kind as InterviewKind);
    setDurationMin(t.durationMin);
  }

  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-low p-lg space-y-md">
      <h3 className="text-h3 text-on-surface">Book an interview</h3>

      <div className="grid gap-md sm:grid-cols-2">
        <label className="block">
          <span className="block text-label-sm text-on-surface-variant mb-xs">Candidate</span>
          <select className={inputCls} value={applicationId} onChange={(e) => setApplicationId(e.target.value)}>
            {bookable.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-label-sm text-on-surface-variant mb-xs">Template</span>
          <select className={inputCls} value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">No template</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-md sm:grid-cols-4">
        <label className="block">
          <span className="block text-label-sm text-on-surface-variant mb-xs">Kind</span>
          <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as InterviewKind)}>
            {INTERVIEW_KINDS.map((k) => (
              <option key={k} value={k}>
                {INTERVIEW_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-label-sm text-on-surface-variant mb-xs">When (IST)</span>
          <input className={inputCls} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <label className="block">
          <span className="block text-label-sm text-on-surface-variant mb-xs">Minutes</span>
          <input className={inputCls} type="number" min={5} max={480} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} />
        </label>
        <label className="block">
          <span className="block text-label-sm text-on-surface-variant mb-xs">Mode</span>
          <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="video">Video</option>
            <option value="phone">Phone</option>
            <option value="in_person">In person</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="block text-label-sm text-on-surface-variant mb-xs">Link or place</span>
        <input className={inputCls} value={locationOrLink} onChange={(e) => setLocationOrLink(e.target.value)} maxLength={500} />
      </label>

      <fieldset>
        <legend className="text-label-sm text-on-surface-variant mb-xs">
          Panel — they get the calendar entry and the scorecard nudge
        </legend>
        <div className="flex flex-wrap gap-xs">
          {users.map((u) => (
            <label
              key={u.id}
              className={
                "inline-flex items-center gap-xs h-8 px-md rounded-full border text-label-sm cursor-pointer transition " +
                (panel.includes(u.id)
                  ? "border-primary bg-primary-fixed/40 text-on-surface"
                  : "border-outline-variant text-on-surface-variant")
              }
            >
              <input
                type="checkbox"
                className="accent-primary"
                checked={panel.includes(u.id)}
                onChange={(e) =>
                  setPanel((prev) => (e.target.checked ? [...prev, u.id] : prev.filter((p) => p !== u.id)))
                }
              />
              {u.username}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex gap-xs">
        <button
          type="button"
          className={primaryBtn}
          disabled={busy || !applicationId || !when}
          onClick={() =>
            onSubmit({
              applicationId,
              templateId: templateId || null,
              kind,
              // datetime-local has no zone; the user typed IST, so state it.
              scheduledAt: new Date(`${when}:00+05:30`).toISOString(),
              durationMin,
              mode,
              locationOrLink: locationOrLink || null,
              panel,
            })
          }
        >
          {busy ? "Booking…" : "Book"}
        </button>
        <button type="button" className={btn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function ScorecardForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [overall, setOverall] = useState<ScorecardVerdict>("yes");
  const [notesMd, setNotesMd] = useState("");

  return (
    <div className="mt-md rounded-lg border border-outline-variant bg-surface-container-low p-md">
      <fieldset>
        <legend className="text-label-sm text-on-surface-variant mb-xs">Your verdict</legend>
        <div className="flex flex-wrap gap-xs">
          {SCORECARD_VERDICTS.map((v) => (
            <label
              key={v}
              className={
                "inline-flex items-center gap-xs h-9 px-md rounded-full border text-label-sm cursor-pointer transition " +
                (overall === v
                  ? "border-primary bg-primary-fixed/40 text-on-surface"
                  : "border-outline-variant text-on-surface-variant")
              }
            >
              <input
                type="radio"
                name="overall"
                className="accent-primary"
                checked={overall === v}
                onChange={() => setOverall(v)}
              />
              {SCORECARD_VERDICT_LABELS[v]}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block mt-md">
        <span className="block text-label-sm text-on-surface-variant mb-xs">
          What did you see? Evidence, not impressions.
        </span>
        <textarea
          className="w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
          rows={4}
          value={notesMd}
          onChange={(e) => setNotesMd(e.target.value)}
        />
      </label>

      <button
        type="button"
        className={primaryBtn + " mt-sm"}
        disabled={busy}
        onClick={() => onSubmit({ overall, notesMd: notesMd || null })}
      >
        {busy ? "Saving…" : "Submit scorecard"}
      </button>
    </div>
  );
}

function TemplatesPanel({ templates }: { templates: TemplateDTO[] }) {
  if (templates.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-xl text-center">
        <div className="text-body-lg text-on-surface mb-xs">No interview templates yet</div>
        <p className="text-body-sm text-on-surface-variant max-w-prose mx-auto">
          A template is a name, a length and a question set. Booking from one fills those in, and the
          prep packet uses its questions as a starting point.
        </p>
      </div>
    );
  }
  return (
    <ul className="grid gap-md sm:grid-cols-2">
      {templates.map((t) => (
        <li key={t.id} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
          <div className="flex items-baseline justify-between gap-sm">
            <span className="text-body-lg font-semibold text-on-surface">{t.name}</span>
            <span className="text-label-sm text-on-surface-variant">
              {INTERVIEW_KIND_LABELS[t.kind as InterviewKind] ?? t.kind} · {t.durationMin} min
            </span>
          </div>
          {t.questionSet.length > 0 && (
            <ol className="mt-sm list-decimal pl-lg space-y-xs text-body-sm text-on-surface-variant">
              {t.questionSet.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
          )}
        </li>
      ))}
    </ul>
  );
}

function EmptyInterviews({ tab, canBook, onBook }: { tab: string; canBook: boolean; onBook: () => void }) {
  const copy: Record<string, { title: string; body: string }> = {
    schedule: {
      title: "Nothing booked",
      body: "Book an interview and it appears here, on the panel's calendar feed, and on the candidate's timeline.",
    },
    awaiting: {
      title: "Every scorecard is in",
      body: "A completed interview with no scorecard shows up here, and its panel gets nudged 2 and 24 hours after it ends.",
    },
    transcripts: {
      title: "No recordings yet",
      body: "Attach a recording or paste a transcript on an interview and it shows here.",
    },
  };
  const { title, body } = copy[tab] ?? copy.schedule!;
  return (
    <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-xl text-center">
      <div className="text-body-lg text-on-surface mb-xs">{title}</div>
      <p className="text-body-sm text-on-surface-variant max-w-prose mx-auto mb-md">{body}</p>
      {tab === "schedule" && canBook && (
        <button type="button" className={primaryBtn} onClick={onBook}>
          Book an interview
        </button>
      )}
    </div>
  );
}
