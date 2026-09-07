"use client";

import Link from "next/link";
import { useState } from "react";
import { formatHiringDate } from "@/lib/hiring/core";
import { TALENT_POOL_STATE_LABELS, type TalentPoolState } from "@/lib/hiring/constants";

type CandidateDTO = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  currentTitle: string | null;
  currentEmployer: string | null;
  locationText: string | null;
  totalExperienceYears: number | null;
  noticePeriodDays: number | null;
  currentCtcLakh: number | null;
  expectedCtcLakh: number | null;
  resumeUrl: string | null;
  portfolioUrl: string | null;
  linkedinUrl: string | null;
  tags: string[];
  source: string;
  sourceDetail: string | null;
  ownerName: string | null;
  createdByName: string | null;
  consentAt: string | null;
  dataRetentionUntil: string | null;
  createdAt: string;
  poolState: string | null;
};

type ApplicationDTO = {
  id: string;
  jobId: string;
  jobTitle: string;
  stageName: string | null;
  status: string;
  aiScore: number | null;
  appliedAt: string;
};

type MatchDTO = {
  jobId: string;
  title: string;
  fit: number;
  matchedMustHaves: string[];
  missingMustHaves: string[];
  matchedNiceToHaves: string[];
  jobStatus: string;
  alreadyApplied: boolean;
};

type NoteDTO = { id: string; bodyMd: string; authorName: string | null; createdAt: string };

const card = "rounded-xl border border-outline-variant bg-surface-container-lowest";

export function CandidateProfileClient({
  candidate: c,
  applications,
  matches,
  notes,
  hasOpenJobs,
}: {
  candidate: CandidateDTO;
  applications: ApplicationDTO[];
  matches: MatchDTO[];
  notes: NoteDTO[];
  hasOpenJobs: boolean;
}) {
  return (
    <div className="space-y-md">
      <Link href="/hiring/talent-pool" className="text-body-sm text-on-surface-variant hover:text-on-surface">
        ← Back to talent pool
      </Link>

      <div className="grid gap-md lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="space-y-md">
          <Details candidate={c} />
          <Matches matches={matches} hasOpenJobs={hasOpenJobs} />
          <Applications applications={applications} />
          <Notes notes={notes} />
        </div>
        <Resume url={c.resumeUrl} name={c.fullName} />
      </div>
    </div>
  );
}

function Details({ candidate: c }: { candidate: CandidateDTO }) {
  const facts: Array<[string, string | null]> = [
    ["Email", c.email],
    ["Phone", c.phone],
    ["Current role", c.currentTitle],
    ["Employer", c.currentEmployer],
    ["Location", c.locationText],
    ["Experience", c.totalExperienceYears !== null ? `${c.totalExperienceYears} years` : null],
    ["Notice period", c.noticePeriodDays !== null ? `${c.noticePeriodDays} days` : null],
    ["Current CTC", c.currentCtcLakh !== null ? `₹${c.currentCtcLakh} L` : null],
    ["Expected CTC", c.expectedCtcLakh !== null ? `₹${c.expectedCtcLakh} L` : null],
    ["Owner", c.ownerName],
    ["Added by", c.createdByName],
    ["Added on", formatHiringDate(c.createdAt)],
  ];

  return (
    <section className={`${card} p-lg space-y-md`}>
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div>
          <h2 className="text-title-md text-on-surface">{c.fullName}</h2>
          <div className="text-body-sm text-on-surface-variant">
            {c.currentTitle ?? "Role not stated"}
            {c.currentEmployer ? ` · ${c.currentEmployer}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-xs">
          {c.poolState && (
            <span className="h-7 inline-flex items-center px-sm rounded-full bg-surface-container text-label-sm text-on-surface">
              {TALENT_POOL_STATE_LABELS[c.poolState as TalentPoolState] ?? c.poolState}
            </span>
          )}
          <span className="h-7 inline-flex items-center px-sm rounded-full bg-surface-container text-label-sm text-on-surface-variant">
            {c.sourceDetail ?? c.source}
          </span>
        </div>
      </div>

      <dl className="grid gap-x-lg gap-y-sm sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-label-sm uppercase tracking-wider text-on-surface-variant">{label}</dt>
            <dd className="text-body-md text-on-surface break-words">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>

      {(c.linkedinUrl || c.portfolioUrl) && (
        <div className="flex flex-wrap gap-sm">
          {c.linkedinUrl && <ExternalLink href={c.linkedinUrl} label="LinkedIn" />}
          {c.portfolioUrl && <ExternalLink href={c.portfolioUrl} label="Portfolio" />}
        </div>
      )}

      {c.tags.length > 0 && (
        <div>
          <div className="text-label-sm uppercase tracking-wider text-on-surface-variant mb-xs">
            Skills read from the résumé
          </div>
          <div className="flex flex-wrap gap-xs">
            {c.tags.map((t) => (
              <span key={t} className="h-6 inline-flex items-center px-sm rounded-full bg-surface-container text-label-sm">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Somebody whose CV arrived in a folder never applied to us. Saying so on
          the record is the difference between a talent pool and a list of
          people who did not consent to being on it. */}
      {!c.consentAt && (
        <p className="text-body-sm text-on-surface-variant border-t border-outline-variant pt-sm">
          No consent on record — this résumé was imported, not submitted.
          {c.dataRetentionUntil ? ` Held until ${formatHiringDate(c.dataRetentionUntil)}.` : ""}
        </p>
      )}
    </section>
  );
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="h-9 inline-flex items-center px-md rounded-lg border border-outline-variant text-body-sm text-on-surface hover:border-primary"
    >
      {label}
    </a>
  );
}

function Matches({ matches, hasOpenJobs }: { matches: MatchDTO[]; hasOpenJobs: boolean }) {
  return (
    <section className={`${card} p-lg space-y-sm`}>
      <div>
        <h3 className="text-title-sm text-on-surface">Fit against open roles</h3>
        {/* This is the free keyword matcher, not the AI rubric score. Presenting
            it as one would put an unexplainable number next to a person's name,
            so every row shows the evidence it is counting. */}
        <p className="text-body-sm text-on-surface-variant">
          A keyword comparison of this résumé against each open role — a sorting hint, not an
          assessment. The AI score with per-criterion reasoning lives on an application.
        </p>
      </div>

      {!hasOpenJobs ? (
        <p className="text-body-sm text-on-surface-variant">No roles are open right now.</p>
      ) : matches.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">
          Nothing on this résumé lines up with the open roles.
        </p>
      ) : (
        <ul className="space-y-sm">
          {matches.map((m) => (
            <li key={m.jobId} className="rounded-lg border border-outline-variant p-md space-y-xs">
              <div className="flex items-center justify-between gap-sm">
                <Link href={`/hiring/jobs/${m.jobId}`} className="text-body-lg text-on-surface hover:underline">
                  {m.title}
                </Link>
                <div className="flex items-center gap-sm shrink-0">
                  {m.alreadyApplied && (
                    <span className="text-label-sm text-on-surface-variant">already applied</span>
                  )}
                  <span className="text-title-sm tabular-nums text-on-surface">{m.fit}%</span>
                </div>
              </div>

              <div className="h-1.5 rounded-full bg-surface-container overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${m.fit}%` }} />
              </div>

              <div className="text-body-sm text-on-surface-variant space-y-2xs">
                {m.matchedMustHaves.length > 0 && (
                  <div>
                    <span className="text-on-surface">Meets:</span> {m.matchedMustHaves.join(", ")}
                  </div>
                )}
                {m.missingMustHaves.length > 0 && (
                  <div>
                    <span className="text-on-surface">Not evidenced:</span> {m.missingMustHaves.join(", ")}
                  </div>
                )}
                {m.matchedNiceToHaves.length > 0 && (
                  <div>Also has: {m.matchedNiceToHaves.join(", ")}</div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Applications({ applications }: { applications: ApplicationDTO[] }) {
  return (
    <section className={`${card} p-lg space-y-sm`}>
      <h3 className="text-title-sm text-on-surface">Applications</h3>
      {applications.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">
          None. This person is in the talent pool, not in a pipeline.
        </p>
      ) : (
        <ul className="space-y-xs">
          {applications.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-sm rounded-lg border border-outline-variant p-sm">
              <div className="min-w-0">
                <Link href={`/hiring/jobs/${a.jobId}`} className="text-body-md text-on-surface hover:underline">
                  {a.jobTitle}
                </Link>
                <div className="text-caption text-on-surface-variant">
                  {a.stageName ?? a.status} · applied {formatHiringDate(a.appliedAt)}
                </div>
              </div>
              {a.aiScore !== null && (
                <span className="text-body-sm tabular-nums text-on-surface">{a.aiScore}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Notes({ notes }: { notes: NoteDTO[] }) {
  if (notes.length === 0) return null;
  return (
    <section className={`${card} p-lg space-y-sm`}>
      <h3 className="text-title-sm text-on-surface">Notes</h3>
      <ul className="space-y-sm">
        {notes.map((n) => (
          <li key={n.id} className="border-b border-outline-variant last:border-0 pb-sm last:pb-0">
            <div className="text-caption text-on-surface-variant">
              {n.authorName ?? "Someone"} · {formatHiringDate(n.createdAt)}
            </div>
            <p className="text-body-sm text-on-surface whitespace-pre-wrap">{n.bodyMd}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Resume({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <section className={`${card} p-lg space-y-sm lg:sticky lg:top-md self-start`}>
      <div className="flex items-center justify-between gap-sm">
        <h3 className="text-title-sm text-on-surface">Résumé</h3>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="h-9 inline-flex items-center px-md rounded-lg border border-outline-variant text-body-sm text-on-surface hover:border-primary"
          >
            Open
          </a>
        )}
      </div>

      {!url ? (
        <p className="text-body-sm text-on-surface-variant">
          No résumé is stored for {name}.
        </p>
      ) : failed ? (
        <p className="text-body-sm text-on-surface-variant">
          The file could not be shown here. Use Open to view it in a new tab.
        </p>
      ) : (
        // Served inline through /api/hiring/files behind the candidate:read
        // check, so the browser can render it in place.
        <iframe
          src={url}
          title={`Résumé — ${name}`}
          className="w-full h-[70vh] rounded-lg border border-outline-variant bg-surface-container-lowest"
          onError={() => setFailed(true)}
        />
      )}
    </section>
  );
}
