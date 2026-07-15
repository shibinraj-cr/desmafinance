import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import {
  ATT_SCORE_WEIGHTS,
  PRESENCE_FULL_RATE,
  PRESENCE_ZERO_RATE,
  PUNCTUALITY_ZERO_RATE,
  COMPLETION_ZERO_RATE,
  MIN_ROSTERED_DAYS,
} from "@/lib/hr-attendance-score";
import { ROLLING_CYCLES } from "@/lib/hr-attendance-score-data";
import { SHIFT_GRACE_MINUTES, LCE_LATE_LIMIT_MINUTES, LCE_GRACE_DAYS } from "@/lib/hr-data";

export const dynamic = "force-dynamic";

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Employee-facing explainer for the Attendance Score. Plain-language, read-only,
 * and driven by the SAME constants the scorer uses (weights / thresholds / grace
 * / LCE quota), so it can never drift out of sync with the actual calculation.
 */
export default async function AttendanceScoringPage() {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) redirect("/login");

  const components = [
    {
      label: "Presence",
      max: ATT_SCORE_WEIGHTS.presence,
      what: "How much of your rostered time you actually attended.",
      how: `Attended ÷ rostered days, where a half-day counts as half. Approved paid leave is left out entirely — it never lowers your presence. You earn full marks at ${pct(PRESENCE_FULL_RATE)} attendance and it tapers to zero at ${pct(PRESENCE_ZERO_RATE)}.`,
    },
    {
      label: "Punctuality",
      max: ATT_SCORE_WEIGHTS.punctuality,
      what: "Arriving on time on the days you work.",
      how: `Arriving within ${SHIFT_GRACE_MINUTES} minutes of your shift start is on time — no effect. If you have the late-coming allowance, up to ${LCE_GRACE_DAYS} arrivals per cycle within ${LCE_LATE_LIMIT_MINUTES} minutes are free too. Only arrivals beyond that ("late beyond the allowance") reduce this score; if that happens on ${pct(PUNCTUALITY_ZERO_RATE)} of your worked days it reaches zero.`,
    },
    {
      label: "Full-day",
      max: ATT_SCORE_WEIGHTS.completion,
      what: "Staying through to the end of your shift.",
      how: `Leaving more than ${SHIFT_GRACE_MINUTES} minutes before your shift ends counts as an early departure. Leaving early on ${pct(COMPLETION_ZERO_RATE)} of your worked days takes this to zero.`,
    },
    {
      label: "Discipline",
      max: ATT_SCORE_WEIGHTS.discipline,
      what: "Clean punch records.",
      how: "A day with only one punch (a missed in or out) and each regularisation correction counts as an incident. A clean record keeps full marks.",
    },
  ];

  const bands = [
    { label: "Excellent", range: "80 – 100", tone: "bg-green-100 text-green-800" },
    { label: "Solid", range: "65 – 79", tone: "bg-blue-100 text-blue-800" },
    { label: "Developing", range: "50 – 64", tone: "bg-amber-100 text-amber-800" },
    { label: "Needs attention", range: "below 50", tone: "bg-red-100 text-red-800" },
  ];

  const total = ATT_SCORE_WEIGHTS.presence + ATT_SCORE_WEIGHTS.punctuality + ATT_SCORE_WEIGHTS.completion + ATT_SCORE_WEIGHTS.discipline;

  return (
    <>
      <TopBar title="How your attendance score works" subtitle="A quick guide to the four parts and how they add up" />
      <div className="p-margin space-y-lg max-w-3xl">
        <Section
          title="The idea"
          action={
            <Link href="/me/attendance" className="text-label-sm text-primary font-semibold">
              ← Back to my attendance
            </Link>
          }
        >
          <p className="text-label-sm text-on-surface leading-relaxed">
            Your attendance score is a single number out of <strong>{total}</strong> that summarises your
            attendance behaviour over your last <strong>{ROLLING_CYCLES} salary cycles</strong> (each cycle runs
            26th → 25th). It is built from four parts, weighted by how much they matter. It is a behaviour
            summary for recognition and review — it is <strong>not</strong> your pay, and it is calculated from
            your actual biometric punch record.
          </p>
        </Section>

        <Section title={`The four parts (out of ${total})`}>
          <div className="space-y-md">
            {components.map((c) => (
              <div key={c.label} className="rounded-lg border border-outline-variant p-md">
                <div className="flex items-baseline justify-between gap-md mb-xs">
                  <h5 className="text-label-lg font-bold text-on-surface">{c.label}</h5>
                  <span className="text-label-sm font-bold tabular-nums text-on-surface-variant">
                    {c.max} pts
                  </span>
                </div>
                <p className="text-label-sm text-on-surface font-medium">{c.what}</p>
                <p className="text-caption text-on-surface-variant mt-xs leading-relaxed">{c.how}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="What the bands mean">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-base">
            {bands.map((b) => (
              <div key={b.label} className={`rounded-xl px-md py-sm text-center ${b.tone}`}>
                <div className="text-caption uppercase tracking-wide font-semibold">{b.label}</div>
                <div className="text-label-sm font-bold tabular-nums mt-xs">{b.range}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Good to know">
          <ul className="space-y-sm text-label-sm text-on-surface list-disc pl-lg">
            <li>
              <strong>Approved paid leave never hurts your score.</strong> Leave you&apos;ve had approved is
              excluded from presence, so taking approved leave is not penalised.
            </li>
            <li>
              <strong>The late-coming allowance is free.</strong> Arrivals within your granted allowance don&apos;t
              dent punctuality — only being late beyond it does.
            </li>
            <li>
              <strong>You need about a month of data.</strong> Until you have at least {MIN_ROSTERED_DAYS} rostered
              days on record, no score is shown — a handful of days would be misleading.
            </li>
            <li>
              <strong>It&apos;s a rolling window.</strong> The score always reflects your most recent{" "}
              {ROLLING_CYCLES} cycles, so it improves as your recent attendance improves.
            </li>
          </ul>
        </Section>

        <div className="pt-xs">
          <Link href="/me/attendance" className="text-label-sm text-primary font-semibold">
            ← Back to my attendance
          </Link>
        </div>
      </div>
    </>
  );
}
