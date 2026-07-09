import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import {
  SCORE_WEIGHTS,
  SCORE_BANDS,
  CONVERSION_TARGET_PCT,
  FIRST_RESPONSE_FAST_HOURS,
  RESPONSE_SLA_HOURS,
} from "@/lib/crm-score";

export const dynamic = "force-dynamic";

// Illustrative point values, derived from the live scorer's constants so the
// guide can never state a threshold the scorecard doesn't actually use.
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const convPts = (pct: number) => Math.round(clamp01(pct / CONVERSION_TARGET_PCT) * SCORE_WEIGHTS.conversion);
const respPts = (h: number) =>
  Math.round(clamp01(1 - (h - FIRST_RESPONSE_FAST_HOURS) / (RESPONSE_SLA_HOURS - FIRST_RESPONSE_FAST_HOURS)) * SCORE_WEIGHTS.responsiveness);
const discPts = (pct: number) => Math.round((pct / 100) * SCORE_WEIGHTS.discipline);

// The four parameters, ordered biggest-lever-first (by weight). Gold ramp keeps
// the split on-brand; the two paler segments take dark text for contrast.
const PARAMS = [
  { key: "conversion", name: "Conversion", weight: SCORE_WEIGHTS.conversion, bg: "#A9740A", fg: "#ffffff" },
  { key: "hygiene", name: "Pipeline hygiene", weight: SCORE_WEIGHTS.hygiene, bg: "#C6900F", fg: "#ffffff" },
  { key: "responsiveness", name: "Responsiveness", weight: SCORE_WEIGHTS.responsiveness, bg: "#E0AC3A", fg: "#3a2c08" },
  { key: "discipline", name: "Task discipline", weight: SCORE_WEIGHTS.discipline, bg: "#EFCB78", fg: "#3a2c08" },
] as const;

const BAND_TEXT: Record<string, string> = {
  excellent: "text-green-700",
  solid: "text-accent",
  developing: "text-amber-600",
  attention: "text-error",
};

/** "80 – 100" / "below 50" style range for a band, computed from the ordered bounds. */
function bandRange(i: number): string {
  const b = SCORE_BANDS[i];
  if (b.min === 0) return `below ${SCORE_BANDS[i - 1].min}`;
  const upper = i === 0 ? 100 : SCORE_BANDS[i - 1].min - 1;
  return `${b.min} – ${upper}`;
}

function Card({
  kicker,
  name,
  weight,
  children,
  window,
}: {
  kicker: string;
  name: string;
  weight: number;
  children: React.ReactNode;
  window: string;
}) {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-sm">
      <div className="flex items-start justify-between gap-base">
        <div>
          <p className="text-caption font-semibold uppercase tracking-wider text-on-surface-variant">{kicker}</p>
          <h3 className="text-h3 text-on-surface">{name}</h3>
        </div>
        <div className="shrink-0 text-right leading-none">
          <span className="text-[40px] font-bold tabular-nums text-accent">{weight}</span>
          <span className="block text-caption uppercase tracking-wider text-on-surface-variant">points</span>
        </div>
      </div>
      <div className="mt-md space-y-sm">{children}</div>
      <span className="mt-md inline-block rounded-full border border-dashed border-outline-variant px-sm py-[2px] text-caption text-on-surface-variant">
        {window}
      </span>
    </div>
  );
}

/** A labelled line inside a parameter card: MEASURES / SCORED / FLAGGED. */
function Line({ tag, children }: { tag: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_1fr] gap-x-base gap-y-[2px] sm:items-baseline max-sm:grid-cols-1">
      <span className="text-caption font-bold uppercase tracking-wider text-on-surface-variant">{tag}</span>
      <p className="text-label-sm text-on-surface">{children}</p>
    </div>
  );
}

/** The "To improve →" callout at the bottom of a parameter card. */
function Improve({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-container-low px-md py-sm text-label-sm text-on-surface">
      <span className="font-bold text-primary">To improve → </span>
      {children}
    </div>
  );
}

export default async function ScorecardGuidePage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) {
    return (
      <>
        <TopBar title="L2 Scorecard — Guide" subtitle="CRM" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            You don&apos;t have access to the CRM. Ask an administrator to grant you the CRM pages.
          </div>
        </div>
      </>
    );
  }

  const total = PARAMS.reduce((s, p) => s + p.weight, 0);

  return (
    <>
      <TopBar title="L2 Scorecard — Guide" subtitle="How your score is calculated" />
      <div className="p-margin space-y-lg">
        <Link href="/crm/team" className="inline-flex w-fit items-center text-label-sm font-semibold text-primary hover:underline">
          ← Back to Activity
        </Link>

        {/* Intro + points split */}
        <Section title="Your score, out of 100">
          <p className="max-w-[65ch] text-label-sm text-on-surface-variant">
            Your L2 Scorecard is a single score out of <strong className="text-on-surface">{total}</strong>, updated live on the
            Activity page. It rewards four things: closing the leads you&apos;re given, replying fast, following through on your
            tasks, and keeping your pipeline clean. Here&apos;s exactly how each part is scored — and how to move it up.
          </p>

          <p className="mt-lg mb-sm text-caption font-semibold uppercase tracking-wider text-on-surface-variant">
            How the {total} points split
          </p>
          <div
            className="flex h-11 w-full gap-[3px] overflow-hidden rounded-lg"
            role="img"
            aria-label={PARAMS.map((p) => `${p.name} ${p.weight}`).join(", ")}
          >
            {PARAMS.map((p) => (
              <div
                key={p.key}
                style={{ flexGrow: p.weight, background: p.bg, color: p.fg }}
                className="flex items-center justify-center text-[13px] font-bold tabular-nums"
              >
                {p.weight}
              </div>
            ))}
          </div>
          <div className="mt-sm flex flex-wrap gap-x-lg gap-y-xs text-caption text-on-surface-variant">
            {PARAMS.map((p) => (
              <span key={p.key} className="inline-flex items-center gap-xs">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.bg }} />
                <strong className="text-on-surface">{p.name}</strong> {p.weight}
              </span>
            ))}
          </div>

          {/* Band legend */}
          <div className="mt-lg grid grid-cols-2 gap-sm sm:grid-cols-4">
            {SCORE_BANDS.map((b, i) => (
              <div key={b.key} className="rounded-lg border border-outline-variant p-sm">
                <div className={`text-label-sm font-bold ${BAND_TEXT[b.key]}`}>{b.label}</div>
                <div className="text-caption tabular-nums text-on-surface-variant">{bandRange(i)}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* The four parameters */}
        <div className="space-y-gutter">
          <Card kicker="The biggest lever" name="Conversion" weight={SCORE_WEIGHTS.conversion} window="Window: current month">
            <Line tag="Measures">
              Of the leads assigned to you <span className="font-semibold text-on-surface">this month</span>, how many you
              enrolled — Enrolled ÷ Assigned.
            </Line>
            <Line tag="Scored">
              <span className="font-semibold text-on-surface">{CONVERSION_TARGET_PCT}% or higher</span> earns the full{" "}
              {SCORE_WEIGHTS.conversion}. It scales down below that — about <strong>{convPts(10)}</strong> at 10%, about{" "}
              <strong>{convPts(5)}</strong> at 5%.
            </Line>
            <Improve>
              Qualify well, handle objections, and get eligible leads across the line to enrolment. Quality of follow-up beats
              quantity of leads.
            </Improve>
          </Card>

          <Card kicker="Don't let leads rot" name="Pipeline hygiene" weight={SCORE_WEIGHTS.hygiene} window="Window: live (right now)">
            <Line tag="Measures">
              Whether your active leads are being worked. It counts{" "}
              <span className="font-semibold text-on-surface">attention flags</span> against how many active leads you hold.
            </Line>
            <Line tag="Flagged">
              A lead is flagged when it&apos;s untouched past its stage deadline (<strong>SLA breach</strong>), untouched 30+ days
              (<strong>abandoned</strong>), stuck in one stage 14+ days (<strong>stuck</strong>), or has{" "}
              <strong>no next task</strong> scheduled.
            </Line>
            <Line tag="Scored">
              A <span className="font-semibold text-on-surface">clean book</span> (no flags) earns the full{" "}
              {SCORE_WEIGHTS.hygiene}. The more flagged leads relative to your total, the lower it goes — down to 0.
            </Line>
            <Improve>
              Give every active lead a next task, touch it within its stage deadline, and never let one sit for weeks. A lead
              with an upcoming scheduled task is <strong>not</strong> flagged — so always book the next step.
            </Improve>
          </Card>

          <Card kicker="Speed to first contact" name="Responsiveness" weight={SCORE_WEIGHTS.responsiveness} window="Window: the period you're viewing">
            <Line tag="Measures">
              How quickly you make your <span className="font-semibold text-on-surface">first contact</span> (call / email /
              WhatsApp) after a lead is assigned to you — your median first-response time.
            </Line>
            <Line tag="Scored">
              <span className="font-semibold text-on-surface">{FIRST_RESPONSE_FAST_HOURS} hours or faster</span> earns the full{" "}
              {SCORE_WEIGHTS.responsiveness}; <span className="font-semibold text-on-surface">{RESPONSE_SLA_HOURS} hours</span>{" "}
              (our SLA) or slower earns 0 — about <strong>{respPts(15)}</strong> at 15 hours.
            </Line>
            <Improve>
              Contact every new lead the same day, ideally within a few hours — <strong>and log it in the CRM</strong>. Only
              logged contacts count, and leads you haven&apos;t contacted at all count against you.
            </Improve>
          </Card>

          <Card kicker="Follow through on time" name="Task discipline" weight={SCORE_WEIGHTS.discipline} window="Window: the period you're viewing">
            <Line tag="Measures">
              Of the follow-up tasks you completed, how many were done <span className="font-semibold text-on-surface">on or
              before</span> their due date.
            </Line>
            <Line tag="Scored">
              <span className="font-semibold text-on-surface">100% on time</span> earns the full {SCORE_WEIGHTS.discipline}, and
              it&apos;s directly proportional — 80% on time earns <strong>{discPts(80)}</strong>.
            </Line>
            <Improve>Clear your tasks by their due date. Don&apos;t let a follow-up slip past the day it&apos;s due.</Improve>
          </Card>
        </div>

        {/* Neutral note */}
        <div className="rounded-xl bg-surface-container-low px-lg py-md text-label-sm text-on-surface-variant">
          <span className="font-semibold text-on-surface">No data, no penalty.</span> If you have nothing to measure in an area
          for the period — say no leads assigned yet this month — that part is scored <strong>neutrally</strong>. It neither
          helps nor hurts your score.
        </div>

        {/* Quick wins */}
        <Section title="Five quick wins">
          <ol className="space-y-sm">
            {[
              "Contact and log every new lead the same day.",
              "Always schedule the next task before you move on.",
              "Close your tasks by their due date.",
              "Revisit any lead you've left untouched.",
              "Push qualified leads toward enrolment.",
            ].map((w, i) => (
              <li key={i} className="grid grid-cols-[28px_1fr] items-baseline gap-base text-label-sm text-on-surface">
                <span className="grid h-6 w-6 place-items-center rounded-md border border-outline-variant text-caption font-bold tabular-nums text-accent">
                  {i + 1}
                </span>
                {w}
              </li>
            ))}
          </ol>
        </Section>

        <p className="text-caption text-on-surface-variant">
          Find the scorecard at <Link href="/crm/team" className="font-semibold text-primary hover:underline">Activity → L2
          Scorecard</Link>, ranked across the whole team. Applies to all L2 consultants.
        </p>
      </div>
    </>
  );
}
